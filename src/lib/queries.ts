import { db } from './db';
import {
  brierScore, logLoss, brierSkillScore, reliabilityBins, devigTwoWay,
  FEATURE_NAMES, type BinaryOutcome, type FeatureName,
} from '@tti/model';

/**
 * Consultas de lectura. SOLO SERVIDOR: se ejecutan en páginas Astro y API
 * routes, y el resultado viaja a las islas de React como props ya resueltos.
 * (Ver la nota de src/lib/db.ts: sin RLS, el navegador no toca la base.)
 */

/** model_version activo de la app. */
export async function getModelVersion(): Promise<string> {
  const c = db();
  const r = await c.execute("select v from app_config where k = 'model_version'");
  return String(r.rows[0]?.v ?? '');
}

export interface RankingRow {
  playerId: number;
  name: string;
  tour: string;
  elo: number;
  matches: number;
}

export interface DbStats {
  players: number;
  tournaments: number;
  matches: number;
  completed: number;
  withOdds: number;
  predictions: number;
  firstSeason: number | null;
  lastSeason: number | null;
  lastMatch: string | null;
}

export async function getStats(): Promise<DbStats> {
  const c = db();
  const one = async (sql: string) => Number((await c.execute(sql)).rows[0]?.n ?? 0);
  const range = (
    await c.execute('select min(season) a, max(season) b, max(played_on) c from matches')
  ).rows[0];
  return {
    players: await one('select count(*) n from players'),
    tournaments: await one('select count(*) n from tournaments'),
    matches: await one('select count(*) n from matches'),
    completed: await one("select count(*) n from matches where status = 'completed'"),
    withOdds: await one('select count(distinct match_id) n from odds'),
    predictions: await one('select count(*) n from model_outputs'),
    firstSeason: range?.a === null ? null : Number(range?.a),
    lastSeason: range?.b === null ? null : Number(range?.b),
    lastMatch: (range?.c as string | null) ?? null,
  };
}

/**
 * Ranking Elo. `surface` = 'all' para el rating global.
 *
 * ATP y WTA son POOLS SEPARADOS: nunca juegan entre sí, así que sus Elo no son
 * comparables entre circuitos y la consulta siempre filtra por uno.
 */
export async function getRanking(
  tour: 'ATP' | 'WTA',
  surface: 'all' | 'hard' | 'clay' | 'grass' | 'carpet' = 'all',
  limit = 30,
  minMatches = 20,
): Promise<RankingRow[]> {
  const c = db();
  const res = await c.execute({
    sql: `select p.id, p.name, t.code as tour, r.elo, r.matches
          from player_ratings r
          join players p on p.id = r.player_id
          join tours   t on t.id = p.tour_id
          where t.code = ? and r.surface = ? and r.matches >= ?
          order by r.elo desc
          limit ?`,
    args: [tour, surface, minMatches, limit],
  });
  return res.rows.map((r) => ({
    playerId: Number(r.id),
    name: String(r.name),
    tour: String(r.tour),
    elo: Number(r.elo),
    matches: Number(r.matches),
  }));
}

// ── Partidos ─────────────────────────────────────────────────────────────────

export interface MatchRow {
  id: number;
  tour: string;
  tournament: string;
  surface: string | null;
  round: string | null;
  playedOn: string;
  status: string;
  p1Name: string;
  p2Name: string;
  probP1: number | null;
  confidence: number | null;
  /** Ganó p1 (1), p2 (0) o sin resolver (null). */
  p1Won: number | null;
}

function mapMatch(r: Record<string, unknown>): MatchRow {
  return {
    id: Number(r.id),
    tour: String(r.tour),
    tournament: String(r.tournament),
    surface: (r.surface as string | null) ?? null,
    round: (r.round as string | null) ?? null,
    playedOn: String(r.played_on),
    status: String(r.status),
    p1Name: String(r.p1_name),
    p2Name: String(r.p2_name),
    probP1: r.prob_p1 === null || r.prob_p1 === undefined ? null : Number(r.prob_p1),
    confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    p1Won: r.p1_won === null || r.p1_won === undefined ? null : Number(r.p1_won),
  };
}

const MATCH_SELECT = `
  select m.id, t.code as tour, tr.name as tournament, m.surface, m.round, m.played_on, m.status,
         p1.name as p1_name, p2.name as p2_name, m.p1_won,
         mo.prob_p1, mo.confidence
  from matches m
  join tours t on t.id = m.tour_id
  join tournaments tr on tr.id = m.tournament_id
  join players p1 on p1.id = m.p1_id
  join players p2 on p2.id = m.p2_id
  left join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
`;

/** Partidos programados (futuros), los más próximos primero. */
export async function getUpcomingMatches(limit = 40): Promise<MatchRow[]> {
  const c = db();
  const version = await getModelVersion();
  const res = await c.execute({
    sql: `${MATCH_SELECT} where m.status = 'scheduled' order by m.played_on asc, m.id asc limit ?`,
    args: [version, limit],
  });
  return res.rows.map(mapMatch);
}

/**
 * Buscador. Filtra por texto (jugador o torneo) y, opcionalmente, circuito.
 * Los programados van primero; entre los jugados, los más recientes.
 */
export async function searchMatches(
  query: string,
  tour: 'ATP' | 'WTA' | 'all' = 'all',
  limit = 60,
): Promise<MatchRow[]> {
  const c = db();
  const version = await getModelVersion();
  const like = `%${query.trim()}%`;
  const conds: string[] = [];
  const args: unknown[] = [version];
  if (query.trim()) {
    conds.push('(p1.name like ? or p2.name like ? or tr.name like ?)');
    args.push(like, like, like);
  }
  if (tour !== 'all') { conds.push('t.code = ?'); args.push(tour); }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  args.push(limit);
  const res = await c.execute({
    sql: `${MATCH_SELECT} ${where}
          order by case when m.status = 'scheduled' then 0 else 1 end,
                   case when m.status = 'scheduled' then m.played_on end asc,
                   m.played_on desc
          limit ?`,
    args,
  });
  return res.rows.map(mapMatch);
}

// ── Ficha de partido ─────────────────────────────────────────────────────────

// ── Torneos ──────────────────────────────────────────────────────────────────

export interface TournamentCard {
  id: number;
  tour: string;
  name: string;
  season: number;
  surface: string | null;
  series: string | null;
  matches: number;
  played: number;
  scheduled: number;
  live: number;
  firstDate: string | null;
  lastDate: string | null;
}

function mapTournament(r: Record<string, unknown>): TournamentCard {
  return {
    id: Number(r.id),
    tour: String(r.tour),
    name: String(r.name),
    season: Number(r.season),
    surface: (r.surface as string | null) ?? null,
    series: (r.series as string | null) ?? null,
    matches: Number(r.matches),
    played: Number(r.played),
    scheduled: Number(r.scheduled),
    live: Number(r.live),
    firstDate: (r.first_date as string | null) ?? null,
    lastDate: (r.last_date as string | null) ?? null,
  };
}

const TOURNAMENT_SELECT = `
  select tr.id, t.code as tour, tr.name, tr.season, tr.surface, tr.series,
         count(m.id) as matches,
         sum(case when m.status = 'completed' then 1 else 0 end) as played,
         sum(case when m.status = 'scheduled' then 1 else 0 end) as scheduled,
         (select count(*) from live_scores ls join matches lm on lm.id = ls.match_id
            where lm.tournament_id = tr.id and ls.state = 'live') as live,
         min(m.played_on) as first_date, max(m.played_on) as last_date
  from tournaments tr
  join tours t on t.id = tr.tour_id
  join matches m on m.tournament_id = tr.id
`;

/** Torneos EN VIVO: los que tienen al menos un partido en curso. */
export async function getLiveTournaments(): Promise<TournamentCard[]> {
  const c = db();
  const res = await c.execute(`
    ${TOURNAMENT_SELECT}
    where exists (
      select 1 from live_scores ls join matches lm on lm.id = ls.match_id
      where lm.tournament_id = tr.id and ls.state = 'live'
    )
    group by tr.id order by tr.name
  `);
  return res.rows.map(mapTournament);
}

/** Torneos con partidos programados (próximos), por fecha de inicio. */
export async function getUpcomingTournaments(limit = 12): Promise<TournamentCard[]> {
  const c = db();
  const res = await c.execute({
    sql: `${TOURNAMENT_SELECT}
          where tr.id in (select tournament_id from matches where status = 'scheduled')
          group by tr.id
          order by (select min(played_on) from matches where tournament_id = tr.id and status = 'scheduled') asc
          limit ?`,
    args: [limit],
  });
  return res.rows.map(mapTournament);
}

/** Torneos más recientes con resultados, para explorar el histórico. */
export async function getRecentTournaments(limit = 12): Promise<TournamentCard[]> {
  const c = db();
  const res = await c.execute({
    sql: `${TOURNAMENT_SELECT}
          group by tr.id
          order by last_date desc
          limit ?`,
    args: [limit],
  });
  return res.rows.map(mapTournament);
}

export interface TournamentDetail {
  card: TournamentCard;
  /** Partidos por ronda, en orden de cuadro. */
  rounds: { round: string; matches: MatchRow[] }[];
}

// Orden canónico de rondas (de la primera a la final).
const ROUND_ORDER = [
  'Round Robin', '1st Round', '2nd Round', '3rd Round', '4th Round',
  'Quarterfinals', 'Semifinals', 'The Final',
];
function roundRank(r: string | null): number {
  const i = ROUND_ORDER.indexOf(r ?? '');
  return i === -1 ? 99 : i;
}

export async function getTournamentDetail(id: number): Promise<TournamentDetail | null> {
  const c = db();
  const version = await getModelVersion();

  const cardRow = (await c.execute({
    sql: `${TOURNAMENT_SELECT} where tr.id = ? group by tr.id`,
    args: [id],
  })).rows[0];
  if (!cardRow) return null;

  const matches = (await c.execute({
    sql: `${MATCH_SELECT} where m.tournament_id = ? order by m.played_on, m.id`,
    args: [version, id],
  })).rows.map(mapMatch);

  const byRound = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const key = m.round ?? 'Sin ronda';
    (byRound.get(key) ?? byRound.set(key, []).get(key)!).push(m);
  }
  const rounds = [...byRound.entries()]
    .sort((a, b) => roundRank(a[0]) - roundRank(b[0]))
    .map(([round, matches]) => ({ round, matches }));

  return { card: mapTournament(cardRow), rounds };
}

// ── Partidos en vivo ─────────────────────────────────────────────────────────

export interface LiveMatchRow extends MatchRow {
  scoreP1: string | null;
  scoreP2: string | null;
  liveState: string;
  tournamentId: number;
}

export async function getLiveMatches(): Promise<LiveMatchRow[]> {
  const c = db();
  const version = await getModelVersion();
  const res = await c.execute({
    sql: `
      select m.id, t.code as tour, tr.name as tournament, tr.id as tournament_id,
             m.surface, m.round, m.played_on, m.status,
             p1.name as p1_name, p2.name as p2_name, m.p1_won,
             mo.prob_p1, mo.confidence,
             ls.score_p1, ls.score_p2, ls.state as live_state
      from live_scores ls
      join matches m on m.id = ls.match_id
      join tours t on t.id = m.tour_id
      join tournaments tr on tr.id = m.tournament_id
      join players p1 on p1.id = m.p1_id
      join players p2 on p2.id = m.p2_id
      left join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
      where ls.state = 'live'
      order by ls.updated_at desc
    `,
    args: [version],
  });
  return res.rows.map((r) => ({
    ...mapMatch(r),
    tournamentId: Number(r.tournament_id),
    scoreP1: (r.score_p1 as string | null) ?? null,
    scoreP2: (r.score_p2 as string | null) ?? null,
    liveState: String(r.live_state),
  }));
}

export interface FeatureContribution {
  name: FeatureName;
  value: number;
  weight: number;
  /** Aporte al logit = value × weight. Positivo empuja hacia p1. */
  contribution: number;
}

export interface OddsRow {
  bookmaker: string;
  source: string;
  selection: string;
  odds: number;
  capturedAt: string;
}

export interface MatchDetail extends MatchRow {
  p1Id: number;
  p2Id: number;
  bestOf: number | null;
  court: string | null;
  /** Explicación en palabras guardada por el modelo. */
  reasons: string[];
  /** Aporte de cada feature al pronóstico, mayor magnitud primero. */
  contributions: FeatureContribution[];
  odds: OddsRow[];
  /** Probabilidad implícita devigada del mercado (si hay cuota de dos vías). */
  marketProbP1: number | null;
  setsJson: string | null;
}

/** Nombre legible de cada feature para la explicación en palabras. */
const FEATURE_FRASE: Record<FeatureName, string> = {
  eloDiffSurface: 'el Elo en esta superficie',
  eloDiffOverall: 'el Elo global',
  rankLogDiff: 'el ranking oficial',
  pointsLogDiff: 'los puntos de ranking',
  h2h: 'el head-to-head',
  h2hSurface: 'el head-to-head en esta superficie',
  loadDiff: 'los partidos jugados últimamente',
  intensityDiff: 'el desgaste de los partidos recientes',
  restDiff: 'el descanso',
  formDiff: 'la forma reciente',
  expDiff: 'la experiencia',
  surfaceExpDiff: 'la experiencia en esta superficie',
  bestOf5EloDiff: 'la ventaja al mejor de 5 sets',
};

/** Construye 3-4 frases a partir de los factores que más pesaron. */
function explainFromContributions(
  contributions: FeatureContribution[],
  p1Name: string,
  p2Name: string,
  probP1: number,
): string[] {
  const favorito = probP1 >= 0.5 ? p1Name : p2Name;
  const reasons = [
    `El modelo favorece a ${favorito} con ${Math.round((probP1 >= 0.5 ? probP1 : 1 - probP1) * 100)}%.`,
  ];
  const top = contributions.filter((c) => Math.abs(c.contribution) > 1e-3).slice(0, 3);
  for (const c of top) {
    const haciaP1 = c.contribution >= 0;
    reasons.push(`A favor de ${haciaP1 ? p1Name : p2Name}: ${FEATURE_FRASE[c.name]}.`);
  }
  return reasons;
}

export async function getMatchDetail(id: number): Promise<MatchDetail | null> {
  const c = db();
  const version = await getModelVersion();

  const mr = (await c.execute({
    sql: `${MATCH_SELECT} where m.id = ?`,
    args: [version, id],
  })).rows[0];
  if (!mr) return null;

  const extra = (await c.execute({
    sql: `select m.p1_id, m.p2_id, m.best_of, m.court, m.sets_json, mo.explanation
          from matches m
          left join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
          where m.id = ?`,
    args: [version, id],
  })).rows[0];

  // Contribución de cada feature: valor × peso del ajuste activo.
  const fit = (await c.execute({
    sql: 'select feature_names, weights from model_fits where model_version = ?',
    args: [version],
  })).rows[0];
  const feat = (await c.execute({
    sql: 'select * from match_features where match_id = ?',
    args: [id],
  })).rows[0];

  const contributions: FeatureContribution[] = [];
  if (fit && feat) {
    const names = JSON.parse(String(fit.feature_names)) as FeatureName[];
    const weights = JSON.parse(String(fit.weights)) as number[];
    // Nombre de feature -> columna snake_case de match_features.
    const col: Record<string, string> = {
      eloDiffSurface: 'elo_diff_surface', eloDiffOverall: 'elo_diff_overall',
      rankLogDiff: 'rank_log_diff', pointsLogDiff: 'points_log_diff',
      h2h: 'h2h', h2hSurface: 'h2h_surface', loadDiff: 'load_diff',
      intensityDiff: 'intensity_diff', restDiff: 'rest_diff', formDiff: 'form_diff',
      expDiff: 'exp_diff', surfaceExpDiff: 'surface_exp_diff', bestOf5EloDiff: 'best_of5_elo_diff',
    };
    names.forEach((name, i) => {
      const value = Number(feat[col[name]] ?? 0);
      contributions.push({ name, value, weight: weights[i], contribution: value * weights[i] });
    });
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  const oddsRows = (await c.execute({
    sql: `select bookmaker, source, selection, odds, captured_at from odds
          where match_id = ? order by captured_at desc, bookmaker`,
    args: [id],
  })).rows.map((r) => ({
    bookmaker: String(r.bookmaker), source: String(r.source), selection: String(r.selection),
    odds: Number(r.odds), capturedAt: String(r.captured_at),
  }));

  // Mercado devigado: última cuota de cierre (o la mejor disponible) de dos vías.
  const pick = (sel: string) =>
    oddsRows.find((o) => o.selection === sel && o.bookmaker === 'pinnacle') ??
    oddsRows.find((o) => o.selection === sel && o.bookmaker.startsWith('consensus')) ??
    oddsRows.find((o) => o.selection === sel);
  const o1 = pick('p1');
  const o2 = pick('p2');
  const dev = o1 && o2 ? devigTwoWay(o1.odds, o2.odds) : null;

  const base = mapMatch(mr);
  let reasons: string[] = [];
  try {
    reasons = extra?.explanation ? JSON.parse(String(extra.explanation)) : [];
  } catch { reasons = []; }
  // Las predicciones del modelo con features no guardan texto (solo la línea
  // base Elo lo hacía). Se sintetiza a partir de los factores que más pesaron,
  // así la explicación siempre corresponde al modelo activo.
  if (!reasons.length && contributions.length && base.probP1 !== null) {
    reasons = explainFromContributions(contributions, base.p1Name, base.p2Name, base.probP1);
  }

  return {
    ...base,
    p1Id: Number(extra?.p1_id),
    p2Id: Number(extra?.p2_id),
    bestOf: extra?.best_of === null || extra?.best_of === undefined ? null : Number(extra.best_of),
    court: (extra?.court as string | null) ?? null,
    reasons,
    contributions,
    odds: oddsRows,
    marketProbP1: dev ? dev.p1 : null,
    setsJson: (extra?.sets_json as string | null) ?? null,
  };
}

// ── Calibración ──────────────────────────────────────────────────────────────

export interface CalibrationReport {
  version: string;
  matches: number;
  brierModel: number;
  brierMarket: number;
  logLossModel: number;
  logLossMarket: number;
  skillModel: number;
  skillMarket: number;
  bins: ReturnType<typeof reliabilityBins>;
  /** Solo partidos de test (fuera de muestra), si hay ajuste registrado. */
  testFromSeason: number | null;
}

/**
 * Calibración del modelo contra el mercado sobre partidos ya jugados.
 * `fromSeason` restringe a fuera de muestra (por defecto, lo que diga el ajuste).
 */
export async function getCalibration(fromSeason?: number): Promise<CalibrationReport> {
  const c = db();
  const version = await getModelVersion();

  const fit = (await c.execute({
    sql: 'select test_seasons from model_fits where model_version = ?',
    args: [version],
  })).rows[0];
  // test_seasons se guarda como '>2023'.
  const parsed = fit ? Number(String(fit.test_seasons).replace(/[^\d]/g, '')) : NaN;
  const testFromSeason = Number.isFinite(parsed) ? parsed + 1 : null;
  const from = fromSeason ?? testFromSeason ?? 0;

  const rows = (await c.execute({
    sql: `select m.p1_won, mo.prob_p1, o1.odds as o1, o2.odds as o2
          from matches m
          join model_outputs mo on mo.match_id = m.id and mo.model_version = ?
          left join odds o1 on o1.match_id = m.id and o1.selection='p1' and o1.bookmaker='pinnacle'
          left join odds o2 on o2.match_id = m.id and o2.selection='p2' and o2.bookmaker='pinnacle'
          where m.status='completed' and m.p1_won is not null and m.season >= ?`,
    args: [version, from],
  })).rows;

  const model: BinaryOutcome[] = [];
  const market: BinaryOutcome[] = [];
  for (const r of rows) {
    const actual = (Number(r.p1_won) === 1 ? 1 : 0) as 0 | 1;
    const o1 = r.o1 === null ? null : Number(r.o1);
    const o2 = r.o2 === null ? null : Number(r.o2);
    const dev = o1 && o2 ? devigTwoWay(o1, o2) : null;
    if (!dev) continue; // solo partidos donde también hay mercado, para comparar
    model.push({ prob: Number(r.prob_p1), actual });
    market.push({ prob: dev.p1, actual });
  }

  return {
    version,
    matches: model.length,
    brierModel: brierScore(model),
    brierMarket: brierScore(market),
    logLossModel: logLoss(model),
    logLossMarket: logLoss(market),
    skillModel: brierSkillScore(model),
    skillMarket: brierSkillScore(market),
    bins: reliabilityBins(model, 10),
    testFromSeason,
  };
}

export interface ModelWeight { name: string; weight: number }

export async function getModelWeights(): Promise<ModelWeight[]> {
  const c = db();
  const version = await getModelVersion();
  const fit = (await c.execute({
    sql: 'select feature_names, weights from model_fits where model_version = ?',
    args: [version],
  })).rows[0];
  if (!fit) return [];
  const names = JSON.parse(String(fit.feature_names)) as string[];
  const weights = JSON.parse(String(fit.weights)) as number[];
  return names
    .map((name, i) => ({ name, weight: weights[i] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

// ── Paper Trading ────────────────────────────────────────────────────────────

export interface PaperSummary {
  valueEnabled: boolean;
  initialBankroll: number;
  total: number;
  open: number;
  won: number;
  lost: number;
  profit: number;
  staked: number;
  roi: number | null;
  clvMean: number | null;
  clvPositive: number;
  clvMeasured: number;
  bankroll: number;
}

export async function getPaperSummary(): Promise<PaperSummary | null> {
  const c = db();
  const cfg = (await c.execute('select * from paper_trading_config where id = 1')).rows[0];
  if (!cfg) return null;
  const s = (await c.execute(`
    select count(*) n,
           sum(case when status='open' then 1 else 0 end) open,
           sum(case when status='won' then 1 else 0 end) won,
           sum(case when status='lost' then 1 else 0 end) lost,
           coalesce(sum(coalesce(profit,0)),0) profit,
           coalesce(sum(case when status in ('won','lost') then stake else 0 end),0) staked,
           avg(clv) clv_mean,
           sum(case when clv > 0 then 1 else 0 end) clv_pos,
           sum(case when clv is not null then 1 else 0 end) clv_n
    from paper_trades
  `)).rows[0];
  const initial = Number(cfg.initial_bankroll);
  const profit = Number(s.profit);
  const staked = Number(s.staked);
  const openStake = Number((await c.execute(
    "select coalesce(sum(stake),0) v from paper_trades where status='open'",
  )).rows[0].v);
  return {
    valueEnabled: Number(cfg.value_enabled) === 1,
    initialBankroll: initial,
    total: Number(s.n),
    open: Number(s.open),
    won: Number(s.won),
    lost: Number(s.lost),
    profit,
    staked,
    roi: staked > 0 ? (profit / staked) * 100 : null,
    clvMean: s.clv_mean === null ? null : Number(s.clv_mean),
    clvPositive: Number(s.clv_pos),
    clvMeasured: Number(s.clv_n),
    bankroll: initial + profit - openStake,
  };
}

export interface PaperTradeRow {
  id: number;
  matchId: number;
  p1Name: string;
  p2Name: string;
  selection: string;
  selectionName: string;
  oddsTaken: number;
  edge: number;
  stake: number;
  status: string;
  profit: number | null;
  clv: number | null;
  placedAt: string;
}

export async function getPaperTrades(limit = 50): Promise<PaperTradeRow[]> {
  const c = db();
  const rows = (await c.execute({
    sql: `select pt.id, pt.match_id, pt.selection, pt.odds_taken, pt.edge, pt.stake,
                 pt.status, pt.profit, pt.clv, pt.placed_at,
                 p1.name p1_name, p2.name p2_name
          from paper_trades pt
          join matches m on m.id = pt.match_id
          join players p1 on p1.id = m.p1_id
          join players p2 on p2.id = m.p2_id
          order by pt.placed_at desc limit ?`,
    args: [limit],
  })).rows;
  return rows.map((r) => ({
    id: Number(r.id), matchId: Number(r.match_id),
    p1Name: String(r.p1_name), p2Name: String(r.p2_name),
    selection: String(r.selection),
    selectionName: String(r.selection === 'p1' ? r.p1_name : r.p2_name),
    oddsTaken: Number(r.odds_taken), edge: Number(r.edge), stake: Number(r.stake),
    status: String(r.status),
    profit: r.profit === null ? null : Number(r.profit),
    clv: r.clv === null ? null : Number(r.clv),
    placedAt: String(r.placed_at),
  }));
}
