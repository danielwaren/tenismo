import { db } from './db';
import { sameScore, parseScore } from './score';
import {
  brierScore, logLoss, brierSkillScore, reliabilityBins, devigTwoWay,
  FEATURE_NAMES, estimateMatchAces, MIN_SERVE_GAMES, estimateServeProb,
  type BinaryOutcome, type FeatureName, type ServeProfile, type MatchAceEstimate,
} from '@tti/model';

export type { MatchAceEstimate };

/** Proyección de aces de un partido, con la precisión de la que se ha calculado. */
export interface MatchAces extends MatchAceEstimate {
  /** true = perfiles de esa superficie; false = perfiles globales (menos preciso). */
  bySurface: boolean;
}

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
  /**
   * Fecha del último RESULTADO conocido (no del último partido programado).
   * Es el termómetro de la tubería: si se para, esta fecha se queda quieta
   * mientras el resto de la web sigue pintando datos con normalidad. Se muestra
   * en el panel para que un cron caído se vea, en vez de parecer un calendario.
   */
  lastResult: string | null;
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
    lastResult:
      ((
        await c.execute("select max(played_on) d from matches where status = 'completed'")
      ).rows[0]?.d as string | null) ?? null,
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

/**
 * Partidos programados (futuros), los más próximos primero — pero una final
 * o semifinal va ANTES que un aluvión de primeras rondas de otro cuadro,
 * aunque esas primeras rondas tengan fecha nominal más temprana. `played_on`
 * es una FECHA, no una hora: en un día con 100+ partidos de primera ronda de
 * un Masters 1000, un `order by played_on, id` puro entierra la final de un
 * torneo más chico que juega el mismo día bajo toda esa primera ronda, que es
 * exactamente el caso que se reportó (la final de Washington no aparecía).
 *
 * El filtro de fecha NO es decorativo. `status='scheduled'` solo vuelve a
 * 'completed' cuando la reconciliación encuentra el resultado; si la ingesta se
 * para —el cron murió 8 días seguidos por falta de secrets— esos partidos se
 * quedan congelados y la web sigue anunciándolos como próximos indefinidamente.
 * Un partido con fecha pasada y sin resultado es un fallo de la tubería, no un
 * partido por jugar, y no debe presentarse como tal.
 */
export async function getUpcomingMatches(limit = 40): Promise<MatchRow[]> {
  const c = db();
  const version = await getModelVersion();
  const res = await c.execute({
    sql: `${MATCH_SELECT} where m.status = 'scheduled' and m.played_on::date >= current_date - 1
          order by
            case m.round
              when 'The Final' then 0
              when 'Semifinals' then 1
              when 'Quarterfinals' then 2
              when '4th Round' then 3
              when '3rd Round' then 4
              when '2nd Round' then 5
              when '1st Round' then 6
              when 'Round Robin' then 6
              else 7
            end,
            m.played_on asc, m.id asc
          limit ?`,
    args: [version, limit],
  });
  return res.rows.map(mapMatch);
}

/**
 * Proyección de aces por partido, a partir de las estadísticas de Tennis
 * Abstract (`match_stats`).
 *
 * Todo se agrega POR SUPERFICIE porque la diferencia es enorme: en la base hay
 * 0,34 aces por juego al saque en arcilla frente a 0,63 en hierba. Mezclarlas
 * daría un número que no describe ningún partido real.
 *
 * `conceded` mira el otro lado del mismo partido: los aces que le hicieron a un
 * jugador son los del rival en esa fila. Así el ajuste por restador sale de los
 * mismos datos, sin una segunda fuente.
 *
 * Devuelve solo los partidos para los que hay muestra suficiente en AMBOS
 * jugadores; el resto no aparece en el mapa y la interfaz no pinta nada. La
 * cobertura depende de cuántas fichas se hayan rastreado (`npm run db:ta`).
 */
export async function getAceEstimates(matchIds: number[]): Promise<Map<number, MatchAces>> {
  const out = new Map<number, MatchAces>();
  if (!matchIds.length) return out;

  const c = db();
  const ph = matchIds.map(() => '?').join(',');
  // RESPALDO GLOBAL. Los partidos futuros llegan de ESPN, que no publica la
  // superficie: los 63 programados de hoy la tienen a null, y el torneo
  // tampoco la sabe. Sin respaldo, la proyección no saldría nunca justo donde
  // interesa. Por eso cada agregado se calcula dos veces, por superficie y en
  // conjunto ('ALL'), y se usa el que corresponda. La interfaz avisa cuando ha
  // tirado del global, que es menos preciso: la diferencia entre arcilla y
  // hierba casi duplica la tasa de aces.
  const res = await c.execute({
    sql: `
      with base as (
        select s.player_id, s.aces, s.serve_games,
               o.aces conc, o.serve_games ret_gms,
               mt.surface, coalesce(mt.best_of, 3) best_of
        from match_stats s
        join match_stats o on o.match_id = s.match_id and o.player_id <> s.player_id
        join matches mt on mt.id = s.match_id
      ),
      perfil as (
        select player_id, surface clave,
               sum(aces) aces, sum(serve_games) gms,
               sum(conc) conc, sum(ret_gms) ret_gms
        from base where surface is not null group by player_id, surface
        union all
        select player_id, 'ALL',
               sum(aces), sum(serve_games), sum(conc), sum(ret_gms)
        from base group by player_id
      ),
      circuito as (
        select surface clave, best_of,
               1.0 * sum(aces) / nullif(sum(serve_games), 0) tasa,
               1.0 * sum(serve_games) / count(*) juegos
        from base where surface is not null group by surface, best_of
        union all
        select 'ALL', best_of,
               1.0 * sum(aces) / nullif(sum(serve_games), 0),
               1.0 * sum(serve_games) / count(*)
        from base group by best_of
      )
      select m.id, m.surface is not null tiene_superficie,
             ct.tasa tour_rate, ct.juegos exp_games,
             sa.aces a_aces, sa.gms a_gms, sa.conc a_conc, sa.ret_gms a_ret,
             sb.aces b_aces, sb.gms b_gms, sb.conc b_conc, sb.ret_gms b_ret,
             ga.aces ga_aces, ga.gms ga_gms, ga.conc ga_conc, ga.ret_gms ga_ret,
             gb.aces gb_aces, gb.gms gb_gms, gb.conc gb_conc, gb.ret_gms gb_ret
      from matches m
      join circuito ct
        on ct.clave = coalesce(m.surface, 'ALL') and ct.best_of = coalesce(m.best_of, 3)
      -- Perfil de la superficie del partido…
      left join perfil sa on sa.player_id = m.p1_id and sa.clave = coalesce(m.surface, 'ALL')
      left join perfil sb on sb.player_id = m.p2_id and sb.clave = coalesce(m.surface, 'ALL')
      -- …y el de toda su carrera, como respaldo cuando el primero es corto.
      left join perfil ga on ga.player_id = m.p1_id and ga.clave = 'ALL'
      left join perfil gb on gb.player_id = m.p2_id and gb.clave = 'ALL'
      where m.id in (${ph})`,
    args: matchIds,
  });

  const perfil = (aces: unknown, gms: unknown, conc: unknown, ret: unknown): ServeProfile => {
    const sv = Number(gms ?? 0);
    const rt = Number(ret ?? 0);
    return {
      serveGames: sv,
      aceRate: sv > 0 ? Number(aces ?? 0) / sv : 0,
      returnGames: rt,
      concedeRate: rt > 0 ? Number(conc ?? 0) / rt : 0,
    };
  };

  /**
   * Perfil de la superficie si tiene muestra; si no, el de toda la carrera.
   *
   * Antes se usaba solo el de la superficie y la cobertura se hundía en cuanto
   * un partido ganaba superficie: pasó de 9 tarjetas con proyección a 4, porque
   * un jugador tiene muchos menos partidos en pista dura que en total. El nivel
   * de la superficie lo sigue aportando la media del circuito, que es el punto
   * al que encoge el cálculo, así que el respaldo no descuadra la escala.
   */
  const elegir = (
    sup: ServeProfile,
    global: ServeProfile,
  ): { p: ServeProfile; bySurface: boolean } =>
    sup.serveGames >= MIN_SERVE_GAMES ? { p: sup, bySurface: true } : { p: global, bySurface: false };

  for (const r of res.rows) {
    const conSuperficie = Number(r.tiene_superficie) === 1;
    const a = elegir(perfil(r.a_aces, r.a_gms, r.a_conc, r.a_ret), perfil(r.ga_aces, r.ga_gms, r.ga_conc, r.ga_ret));
    const b = elegir(perfil(r.b_aces, r.b_gms, r.b_conc, r.b_ret), perfil(r.gb_aces, r.gb_gms, r.gb_conc, r.gb_ret));

    const est = estimateMatchAces(a.p, b.p, {
      tourAceRate: Number(r.tour_rate ?? 0),
      expectedServeGames: Number(r.exp_games ?? 0),
    });
    // Sin muestra en los dos lados sería la media del circuito con nombre y
    // apellidos. No se publica.
    if (est?.reliable) {
      out.set(Number(r.id), { ...est, bySurface: conSuperficie && a.bySurface && b.bySurface });
    }
  }
  return out;
}

export interface MarkovInputs {
  pa: number;
  pb: number;
  bestOf: number | null;
  /** Igual que en getAceEstimates: false = tirando del perfil global, no de la superficie. */
  bySurface: boolean;
}

/**
 * Probabilidades de punto al saque (p_a, p_b) para el motor Markov, walk del
 * mismo patrón perfil-por-superficie-con-respaldo-global que `getAceEstimates`
 * — es la misma limitación real (ESPN no da superficie en los programados) y
 * la misma solución. Se usa para proyectar Total de Juegos y Hándicap en el
 * Paper Trading: `packages/model/src/markov.ts` hace las matemáticas, aquí
 * solo se arma el `PointCount` de cada jugador desde `match_stats`.
 */
export async function getMarkovInputs(matchIds: number[]): Promise<Map<number, MarkovInputs>> {
  const out = new Map<number, MarkovInputs>();
  if (!matchIds.length) return out;

  const c = db();
  const ph = matchIds.map(() => '?').join(',');
  const res = await c.execute({
    sql: `
      with base as (
        select s.player_id, s.serve_points, s.first_won, s.second_won,
               o.serve_points opp_svpt, o.first_won opp_fw, o.second_won opp_sw,
               mt.surface, coalesce(mt.best_of, 3) best_of
        from match_stats s
        join match_stats o on o.match_id = s.match_id and o.player_id <> s.player_id
        join matches mt on mt.id = s.match_id
      ),
      perfil as (
        select player_id, surface clave,
               sum(serve_points) svpt, sum(first_won) fw, sum(second_won) sw,
               sum(opp_svpt) ret_pts, sum(opp_svpt - opp_fw - opp_sw) ret_won
        from base where surface is not null group by player_id, surface
        union all
        select player_id, 'ALL',
               sum(serve_points), sum(first_won), sum(second_won),
               sum(opp_svpt), sum(opp_svpt - opp_fw - opp_sw)
        from base group by player_id
      ),
      circuito as (
        select surface clave,
               1.0 * sum(first_won + second_won) / nullif(sum(serve_points), 0) tasa
        from base where surface is not null group by surface
        union all
        select 'ALL', 1.0 * sum(first_won + second_won) / nullif(sum(serve_points), 0)
        from base
      )
      select m.id, m.best_of, m.surface is not null tiene_superficie,
             ct.tasa tour_rate,
             sa.svpt a_svpt, sa.fw a_fw, sa.sw a_sw, sa.ret_pts a_ret_pts, sa.ret_won a_ret_won,
             sb.svpt b_svpt, sb.fw b_fw, sb.sw b_sw, sb.ret_pts b_ret_pts, sb.ret_won b_ret_won,
             ga.svpt ga_svpt, ga.fw ga_fw, ga.sw ga_sw, ga.ret_pts ga_ret_pts, ga.ret_won ga_ret_won,
             gb.svpt gb_svpt, gb.fw gb_fw, gb.sw gb_sw, gb.ret_pts gb_ret_pts, gb.ret_won gb_ret_won
      from matches m
      join circuito ct on ct.clave = coalesce(m.surface, 'ALL')
      left join perfil sa on sa.player_id = m.p1_id and sa.clave = coalesce(m.surface, 'ALL')
      left join perfil sb on sb.player_id = m.p2_id and sb.clave = coalesce(m.surface, 'ALL')
      left join perfil ga on ga.player_id = m.p1_id and ga.clave = 'ALL'
      left join perfil gb on gb.player_id = m.p2_id and gb.clave = 'ALL'
      where m.id in (${ph})`,
    args: matchIds,
  });

  const serveCount = (svpt: unknown, fw: unknown, sw: unknown) => {
    const points = Number(svpt ?? 0);
    return { won: Number(fw ?? 0) + Number(sw ?? 0), points };
  };
  const returnCount = (pts: unknown, won: unknown) => ({ points: Number(pts ?? 0), won: Number(won ?? 0) });

  for (const r of res.rows) {
    const tourServeRate = Number(r.tour_rate ?? 0);
    if (!(tourServeRate > 0)) continue; // sin referencia del circuito, no se puede encoger nada

    const svA = serveCount(r.a_svpt, r.a_fw, r.a_sw);
    const svB = serveCount(r.b_svpt, r.b_fw, r.b_sw);
    const bySurface = Number(r.tiene_superficie) === 1 && svA.points >= MIN_SERVE_GAMES && svB.points >= MIN_SERVE_GAMES;

    const [svAf, rtAf, svBf, rtBf] = bySurface
      ? [svA, returnCount(r.a_ret_pts, r.a_ret_won), svB, returnCount(r.b_ret_pts, r.b_ret_won)]
      : [
          serveCount(r.ga_svpt, r.ga_fw, r.ga_sw), returnCount(r.ga_ret_pts, r.ga_ret_won),
          serveCount(r.gb_svpt, r.gb_fw, r.gb_sw), returnCount(r.gb_ret_pts, r.gb_ret_won),
        ];

    const pa = estimateServeProb(svAf, rtBf, { tourServeRate });
    const pb = estimateServeProb(svBf, rtAf, { tourServeRate });
    out.set(Number(r.id), { pa, pb, bestOf: r.best_of === null ? null : Number(r.best_of), bySurface });
  }
  return out;
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
  select tr.id, max(t.code) as tour, tr.name, tr.season, tr.surface, tr.series,
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
  // Mismo motivo que en getUpcomingMatches: sin el filtro de fecha, un torneo
  // que terminó hace una semana sigue saliendo como "próximo" mientras le quede
  // un partido sin reconciliar.
  const res = await c.execute({
    sql: `${TOURNAMENT_SELECT}
          where tr.id in (
            select tournament_id from matches
            where status = 'scheduled' and played_on::date >= current_date - 1
          )
          group by tr.id
          order by (
            select min(played_on) from matches
            where tournament_id = tr.id and status = 'scheduled' and played_on::date >= current_date - 1
          ) asc
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

// Los partidos en vivo NO se leen de `live_scores`: esa tabla solo la refresca
// el cron y dejaba la web con una foto vieja (partidos terminados marcados como
// en vivo, y los recién empezados sin aparecer). Se consultan a ESPN en el
// momento — ver src/lib/live.ts. `live_scores` se conserva porque alimenta los
// contadores "en vivo" de las tarjetas de torneo.

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

/** Estadísticas de un jugador, calculadas SOLO con lo que la fuente da de verdad. */
export interface PlayerStats {
  playerId: number;
  name: string;
  eloOverall: number | null;
  eloSurface: number | null;
  /** Elo global calculado SOLO con los partidos de los últimos 2 años (scripts/train-elo-recent.ts). */
  eloRecent: number | null;
  matches: number;
  /** % de victorias en toda su historia registrada. */
  winRate: number | null;
  /** % de victorias en esta superficie. */
  winRateSurface: number | null;
  /** Resultados recientes: 'W'/'L' del más nuevo al más viejo. */
  recentForm: ('W' | 'L')[];
}

/** Línea de saque y resto de un jugador en un enfrentamiento concreto. */
export interface H2HLine {
  aces: number;
  doubleFaults: number;
  servePoints: number;
  firstIn: number;
  firstWon: number;
  secondWon: number;
  serveGames: number;
  bpSaved: number;
  bpFaced: number;
}

export interface H2HMeeting {
  /** null si el partido solo existe en el histórico de Tennis Abstract. */
  matchId: number | null;
  key: string;
  playedOn: string;
  tournament: string;
  surface: string | null;
  round: string | null;
  winnerName: string;
  /** Marcador set por set, perspectiva del ganador. */
  score: string;
  /** Estadísticas orientadas a p1/p2 del partido que se está viendo. */
  statsP1: H2HLine | null;
  statsP2: H2HLine | null;
}

/** Promedios de un jugador a lo largo de TODOS los duelos con este rival. */
export interface H2HAverages {
  acesPerMatch: number;
  firstInPct: number;
  firstWonPct: number;
  secondWonPct: number;
  bpSavedPct: number;
  /** Break points convertidos = los que el rival NO salvó. */
  bpConvertedPct: number;
}

export interface H2HStats {
  /** Duelos con estadísticas (puede ser menos que el total de enfrentamientos). */
  withStats: number;
  p1: H2HAverages;
  p2: H2HAverages;
}

/** Marcador set por set orientado a p1 / p2 (no ganador/perdedor). */
export interface SetScore { p1: number; p2: number }

export interface MatchDetail extends MatchRow {
  p1Id: number;
  p2Id: number;
  bestOf: number | null;
  court: string | null;
  reasons: string[];
  contributions: FeatureContribution[];
  odds: OddsRow[];
  marketProbP1: number | null;
  setsJson: string | null;
  /** Marcador set por set orientado a p1/p2 (vacío si no ha terminado). */
  sets: SetScore[];
  gamesP1: number;
  gamesP2: number;
  statsP1: PlayerStats;
  statsP2: PlayerStats;
  /** Historial directo: victorias de p1, de p2 y los enfrentamientos. */
  h2hP1Wins: number;
  h2hP2Wins: number;
  h2h: H2HMeeting[];
  /** Promedios de saque y resto en los duelos previos. null si no hay ninguno. */
  h2hStats: H2HStats | null;
}

/**
 * Historial directo entre dos jugadores, sumando las dos fuentes.
 *
 * `matches` solo llega a 2013 (antes tennis-data publica en .xls binario) y no
 * tiene Challengers. Tennis Abstract sí: en `ta_matches` hay 13.000 partidos de
 * circuito principal anteriores a 2013 y 22.000 de Challenger que aquí no
 * existen. Sin ellos, el head-to-head de cualquier rivalidad que empezara antes
 * sale truncado — y en los veteranos eso es la mitad de los duelos.
 *
 * Los que ya están enlazados NO se cuentan dos veces: se leen de `matches` y
 * `ta_matches` solo aporta los que quedaron sin enlazar.
 */
async function getH2H(
  p1Id: number,
  p2Id: number,
  excludeMatchId: number,
  /** Fecha del partido que se está viendo: solo cuentan los duelos ANTERIORES. */
  playedOn: string,
  p1Name: string,
  p2Name: string,
): Promise<{ meetings: H2HMeeting[]; p1Wins: number; p2Wins: number; stats: H2HStats | null }> {
  const c = db();
  const lo = Math.min(p1Id, p2Id);
  const hi = Math.max(p1Id, p2Id);

  const linea = (r: Record<string, unknown>, p: string): H2HLine | null => {
    const svpt = Number(r[`${p}svpt`] ?? 0);
    if (!svpt) return null;
    return {
      aces: Number(r[`${p}aces`] ?? 0),
      doubleFaults: Number(r[`${p}df`] ?? 0),
      servePoints: svpt,
      firstIn: Number(r[`${p}first_in`] ?? 0),
      firstWon: Number(r[`${p}first_won`] ?? 0),
      secondWon: Number(r[`${p}second_won`] ?? 0),
      serveGames: Number(r[`${p}sv_gms`] ?? 0),
      bpSaved: Number(r[`${p}bp_saved`] ?? 0),
      bpFaced: Number(r[`${p}bp_faced`] ?? 0),
    };
  };

  // ── Enfrentamientos que sí están en nuestra base ───────────────────────────
  const propios = (await c.execute({
    sql: `select m.id, m.played_on, tr.name tournament, m.surface, m.round, m.p1_won, m.p1_id,
                 pw.name winner, m.sets_json,
                 sa.aces a_aces, sa.double_faults a_df, sa.serve_points a_svpt, sa.first_in a_first_in,
                 sa.first_won a_first_won, sa.second_won a_second_won, sa.serve_games a_sv_gms,
                 sa.bp_saved a_bp_saved, sa.bp_faced a_bp_faced,
                 sb.aces b_aces, sb.double_faults b_df, sb.serve_points b_svpt, sb.first_in b_first_in,
                 sb.first_won b_first_won, sb.second_won b_second_won, sb.serve_games b_sv_gms,
                 sb.bp_saved b_bp_saved, sb.bp_faced b_bp_faced
          from matches m
          join tournaments tr on tr.id = m.tournament_id
          left join players pw on pw.id = m.winner_id
          left join match_stats sa on sa.match_id = m.id and sa.player_id = ?
          left join match_stats sb on sb.match_id = m.id and sb.player_id = ?
          where m.status = 'completed' and m.p1_won is not null and m.id <> ?
            and m.p1_id = ? and m.p2_id = ? and m.played_on < ?
          order by m.played_on desc`,
    args: [p1Id, p2Id, excludeMatchId, lo, hi, playedOn],
  })).rows;

  const meetings: H2HMeeting[] = propios.map((r) => {
    const winnerIsP1 = (Number(r.p1_id) === p1Id) === (Number(r.p1_won) === 1);
    let score = '';
    try {
      score = (JSON.parse(String(r.sets_json ?? '[]')) as [number, number][]).map((s) => `${s[0]}-${s[1]}`).join(' ');
    } catch { /* sin marcador */ }
    return {
      matchId: Number(r.id),
      key: `m${r.id}`,
      playedOn: String(r.played_on),
      tournament: String(r.tournament),
      surface: (r.surface as string | null) ?? null,
      round: (r.round as string | null) ?? null,
      winnerName: r.winner ? String(r.winner) : winnerIsP1 ? p1Name : p2Name,
      score,
      statsP1: linea(r, 'a_'),
      statsP2: linea(r, 'b_'),
    };
  });

  // ── Los que solo conoce Tennis Abstract ────────────────────────────────────
  const deTa = (await c.execute({
    sql: `select ta_key, event_date, event, level, surface, round, score, winner_slug,
                 a_player_id, a_slug,
                 a_ace, a_df, a_svpt, a_first_in, a_first_won, a_second_won, a_sv_gms, a_bp_saved, a_bp_faced,
                 b_ace, b_df, b_svpt, b_first_in, b_first_won, b_second_won, b_sv_gms, b_bp_saved, b_bp_faced
          from ta_matches
          where link_status <> 'linked' and conflict = 0
            and ((a_player_id = ? and b_player_id = ?) or (a_player_id = ? and b_player_id = ?))
            and event_date < ?
            -- 'S' son exhibiciones: no cuentan en el head-to-head oficial.
            and (level is null or level <> 'S')
          order by event_date desc`,
    args: [p1Id, p2Id, p2Id, p1Id, playedOn],
  })).rows;

  // Un duelo puede estar en las DOS fuentes sin haberse enlazado: el nombre del
  // torneo cambia con el patrocinador ("Sony Ericsson Open" es el Miami de 2017)
  // y la fecha de TA es la de inicio del torneo, no la del partido. Si no se
  // descartan, el head-to-head los cuenta dos veces: Federer-Nadal salía 17-24
  // cuando son 15-24.
  // Se acepta el mismo AÑO, no solo una ventana de tres semanas, porque
  // tennis-data trae erratas de fecha: su fila del Miami 2017 (Sony Ericsson
  // Open, el patrocinador de entonces) está fechada el 2 de enero cuando la
  // final fue el 2 de abril. Con la ventana estrecha el duplicado se colaba.
  // Que dos jugadores se enfrenten dos veces el mismo año con un marcador
  // idéntico set a set es raro; contar dos veces el mismo partido, seguro.
  const yaEsta = (fecha: string, score: string): boolean =>
    meetings.some((m) => {
      if (!sameScore(m.score, score)) return false;
      const dias = Math.abs(Date.parse(m.playedOn) - Date.parse(fecha)) / 86_400_000;
      return dias <= 21 || m.playedOn.slice(0, 4) === fecha.slice(0, 4);
    });

  for (const r of deTa) {
    // Los walkovers no son enfrentamientos: nadie golpeó una bola y la ATP no
    // los cuenta en el head-to-head. Tennis Abstract los anota con "W/O" y sin
    // marcador. Las retiradas SÍ cuentan, y esas llevan los sets jugados.
    if (!parseScore(String(r.score ?? ''))) continue;
    if (yaEsta(String(r.event_date), String(r.score ?? ''))) continue;

    // El lado A/B de ta_matches va por slug, no por nuestro p1/p2: hay que
    // orientarlo antes de enseñar nada.
    const aEsP1 = Number(r.a_player_id) === p1Id;
    const ganaA = String(r.winner_slug) === String(r.a_slug);
    const winnerIsP1 = aEsP1 === ganaA;
    const ren = (p: 'a' | 'b'): H2HLine | null =>
      linea(
        {
          [`${p}_aces`]: r[`${p}_ace`], [`${p}_df`]: r[`${p}_df`], [`${p}_svpt`]: r[`${p}_svpt`],
          [`${p}_first_in`]: r[`${p}_first_in`], [`${p}_first_won`]: r[`${p}_first_won`],
          [`${p}_second_won`]: r[`${p}_second_won`], [`${p}_sv_gms`]: r[`${p}_sv_gms`],
          [`${p}_bp_saved`]: r[`${p}_bp_saved`], [`${p}_bp_faced`]: r[`${p}_bp_faced`],
        },
        `${p}_`,
      );
    meetings.push({
      matchId: null,
      key: String(r.ta_key),
      playedOn: String(r.event_date),
      tournament: String(r.event),
      surface: r.surface ? String(r.surface).toLowerCase() : null,
      round: (r.round as string | null) ?? null,
      winnerName: winnerIsP1 ? p1Name : p2Name,
      score: String(r.score ?? ''),
      statsP1: aEsP1 ? ren('a') : ren('b'),
      statsP2: aEsP1 ? ren('b') : ren('a'),
    });
  }

  meetings.sort((x, y) => (x.playedOn < y.playedOn ? 1 : -1));

  let p1Wins = 0;
  let p2Wins = 0;
  for (const m of meetings) (m.winnerName === p1Name ? p1Wins++ : p2Wins++);

  // ── Promedios de saque y resto en los duelos ───────────────────────────────
  const conStats = meetings.filter((m) => m.statsP1 && m.statsP2);
  if (!conStats.length) return { meetings, p1Wins, p2Wins, stats: null };

  const sumar = (lado: 'statsP1' | 'statsP2') =>
    conStats.reduce(
      (acc, m) => {
        const l = m[lado]!;
        acc.aces += l.aces; acc.svpt += l.servePoints; acc.firstIn += l.firstIn;
        acc.firstWon += l.firstWon; acc.secondWon += l.secondWon;
        acc.bpSaved += l.bpSaved; acc.bpFaced += l.bpFaced;
        return acc;
      },
      { aces: 0, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, bpSaved: 0, bpFaced: 0 },
    );

  const a = sumar('statsP1');
  const b = sumar('statsP2');
  const pct = (x: number, y: number) => (y > 0 ? (100 * x) / y : 0);
  const media = (propio: typeof a, rival: typeof a): H2HAverages => ({
    acesPerMatch: propio.aces / conStats.length,
    firstInPct: pct(propio.firstIn, propio.svpt),
    firstWonPct: pct(propio.firstWon, propio.firstIn),
    secondWonPct: pct(propio.secondWon, propio.svpt - propio.firstIn),
    bpSavedPct: pct(propio.bpSaved, propio.bpFaced),
    // Los break points que convierte uno son los que el OTRO no salvó.
    bpConvertedPct: pct(rival.bpFaced - rival.bpSaved, rival.bpFaced),
  });

  return {
    meetings,
    p1Wins,
    p2Wins,
    stats: { withStats: conStats.length, p1: media(a, b), p2: media(b, a) },
  };
}

async function getPlayerStats(playerId: number, name: string, surface: string | null): Promise<PlayerStats> {
  const c = db();
  const elo = (await c.execute({
    sql: `select surface, elo from player_ratings where player_id = ? and surface in ('all', ?, 'recent2y')`,
    args: [playerId, surface ?? 'all'],
  })).rows;
  const eloOverall = elo.find((r) => r.surface === 'all');
  const eloSurface = surface ? elo.find((r) => r.surface === surface) : undefined;
  const eloRecent = elo.find((r) => r.surface === 'recent2y');

  // Récord global y por superficie: p1_won marca al ganador respecto a p1_id.
  const rec = (await c.execute({
    sql: `select
            count(*) n,
            sum(case when (m.p1_id = ? and m.p1_won = 1) or (m.p2_id = ? and m.p1_won = 0) then 1 else 0 end) w,
            sum(case when m.surface = ? then 1 else 0 end) ns,
            sum(case when m.surface = ? and ((m.p1_id = ? and m.p1_won = 1) or (m.p2_id = ? and m.p1_won = 0)) then 1 else 0 end) ws
          from matches m
          where m.status = 'completed' and m.p1_won is not null and (m.p1_id = ? or m.p2_id = ?)`,
    args: [playerId, playerId, surface ?? '', surface ?? '', playerId, playerId, playerId, playerId],
  })).rows[0];
  const n = Number(rec.n), w = Number(rec.w), ns = Number(rec.ns), ws = Number(rec.ws);

  const recent = (await c.execute({
    sql: `select case when (m.p1_id = ? and m.p1_won = 1) or (m.p2_id = ? and m.p1_won = 0) then 'W' else 'L' end r
          from matches m where m.status = 'completed' and m.p1_won is not null and (m.p1_id = ? or m.p2_id = ?)
          order by m.played_on desc, m.id desc limit 8`,
    args: [playerId, playerId, playerId, playerId],
  })).rows.map((x) => x.r as 'W' | 'L');

  return {
    playerId, name,
    eloOverall: eloOverall ? Number(eloOverall.elo) : null,
    eloSurface: eloSurface ? Number(eloSurface.elo) : null,
    eloRecent: eloRecent ? Number(eloRecent.elo) : null,
    matches: n,
    winRate: n > 0 ? w / n : null,
    winRateSurface: ns > 0 ? ws / ns : null,
    recentForm: recent,
  };
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
  markovLogit: 'el motor punto a punto (saque y resto)',
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

  const p1Id = Number(extra?.p1_id);
  const p2Id = Number(extra?.p2_id);
  const setsJson = (extra?.sets_json as string | null) ?? null;

  // Marcador set por set, de perspectiva ganador (como se guarda) a p1/p2.
  const sets: SetScore[] = [];
  let gamesP1 = 0, gamesP2 = 0;
  if (setsJson && base.p1Won !== null) {
    try {
      const raw = JSON.parse(setsJson) as [number, number][];
      const p1IsWinner = base.p1Won === 1;
      for (const [wg, lg] of raw) {
        const s = { p1: p1IsWinner ? wg : lg, p2: p1IsWinner ? lg : wg };
        sets.push(s); gamesP1 += s.p1; gamesP2 += s.p2;
      }
    } catch { /* marcador ilegible: se deja vacío */ }
  }

  // Head-to-head entre los dos jugadores. Se excluye el propio partido, que si
  // no se contaría a sí mismo como precedente.
  const {
    meetings: h2h, p1Wins: h2hP1Wins, p2Wins: h2hP2Wins, stats: h2hStats,
  } = await getH2H(p1Id, p2Id, id, base.playedOn, base.p1Name, base.p2Name);

  const [statsP1, statsP2] = await Promise.all([
    getPlayerStats(p1Id, base.p1Name, base.surface),
    getPlayerStats(p2Id, base.p2Name, base.surface),
  ]);

  return {
    ...base,
    p1Id, p2Id,
    bestOf: extra?.best_of === null || extra?.best_of === undefined ? null : Number(extra.best_of),
    court: (extra?.court as string | null) ?? null,
    reasons,
    contributions,
    odds: oddsRows,
    marketProbP1: dev ? dev.p1 : null,
    setsJson,
    sets, gamesP1, gamesP2,
    statsP1, statsP2,
    h2hP1Wins, h2hP2Wins, h2h, h2hStats,
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
  /** Anuladas (push): stake devuelto, ni ganada ni perdida. */
  voidCount: number;
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
           sum(case when status='void' then 1 else 0 end) voidc,
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
    voidCount: Number(s.voidc),
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
  /** 'ML' | 'TOTAL_GAMES' | 'GAMES_HCP'. Set y Aces no tienen aquí: sin cuota real, no hay apuesta que simular. */
  market: string;
  selection: string;
  line: number | null;
  /** Etiqueta lista para pintar: "Fritz T." · "Más de 21.5 juegos" · "Nakashima B. −3.5". */
  selectionName: string;
  oddsTaken: number;
  edge: number;
  stake: number;
  status: string;
  profit: number | null;
  clv: number | null;
  placedAt: string;
}

/** Nombre legible de la selección, según el mercado. */
function paperSelectionName(market: string, selection: string, line: number | null, p1Name: string, p2Name: string): string {
  if (market === 'TOTAL_GAMES') {
    const l = line === null ? '' : ` ${line}`;
    return selection === 'over' ? `Más de${l} juegos` : `Menos de${l} juegos`;
  }
  if (market === 'GAMES_HCP') {
    const name = selection === 'p1' ? p1Name : p2Name;
    const l = line === null ? '' : ` ${line > 0 ? '+' : ''}${line}`;
    return `${name}${l}`;
  }
  return selection === 'p1' ? p1Name : p2Name; // ML
}

const MARKET_LABEL: Record<string, string> = {
  ML: 'Ganador', TOTAL_GAMES: 'Total de juegos', GAMES_HCP: 'Hándicap de juegos',
};

/** Estados por los que se puede filtrar la tabla de apuestas simuladas. */
export const PAPER_STATUSES = ['open', 'won', 'lost', 'void'] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export function isPaperStatus(v: string | null | undefined): v is PaperStatus {
  return !!v && (PAPER_STATUSES as readonly string[]).includes(v);
}

export async function getPaperTrades(limit = 50, status?: PaperStatus): Promise<PaperTradeRow[]> {
  const c = db();
  // El filtro va en SQL y no en JS: filtrando después del `limit` una vista de
  // "perdidas" mostraría solo las que hubiera entre las 50 últimas, no las 50
  // últimas perdidas.
  const rows = (await c.execute({
    sql: `select pt.id, pt.match_id, pt.market, pt.selection, pt.line, pt.odds_taken, pt.edge, pt.stake,
                 pt.status, pt.profit, pt.clv, pt.placed_at,
                 p1.name p1_name, p2.name p2_name
          from paper_trades pt
          join matches m on m.id = pt.match_id
          join players p1 on p1.id = m.p1_id
          join players p2 on p2.id = m.p2_id
          ${status ? 'where pt.status = ?' : ''}
          order by pt.placed_at desc limit ?`,
    args: status ? [status, limit] : [limit],
  })).rows;
  return rows.map((r) => {
    const market = String(r.market);
    const line = r.line === null ? null : Number(r.line);
    return {
      id: Number(r.id), matchId: Number(r.match_id),
      p1Name: String(r.p1_name), p2Name: String(r.p2_name),
      market: MARKET_LABEL[market] ?? market,
      selection: String(r.selection), line,
      selectionName: paperSelectionName(market, String(r.selection), line, String(r.p1_name), String(r.p2_name)),
      oddsTaken: Number(r.odds_taken), edge: Number(r.edge), stake: Number(r.stake),
      status: String(r.status),
      profit: r.profit === null ? null : Number(r.profit),
      clv: r.clv === null ? null : Number(r.clv),
      placedAt: String(r.placed_at),
    };
  });
}

export interface PaperMarketBreakdown {
  market: string;
  n: number;
  open: number;
  won: number;
  lost: number;
  voidCount: number;
  profit: number;
  clvMean: number | null;
}

/** Desglose por mercado: aparece en cuanto hay más de un mercado con apuestas. */
export async function getPaperMarketBreakdown(): Promise<PaperMarketBreakdown[]> {
  const c = db();
  const rows = (await c.execute(`
    select market, count(*) n,
           sum(case when status='open' then 1 else 0 end) open,
           sum(case when status='won' then 1 else 0 end) won,
           sum(case when status='lost' then 1 else 0 end) lost,
           sum(case when status='void' then 1 else 0 end) voidc,
           coalesce(sum(coalesce(profit,0)),0) profit,
           avg(clv) clv_mean
    from paper_trades group by market order by market
  `)).rows;
  return rows.map((r) => ({
    market: MARKET_LABEL[String(r.market)] ?? String(r.market),
    n: Number(r.n), open: Number(r.open), won: Number(r.won), lost: Number(r.lost), voidCount: Number(r.voidc),
    profit: Math.round(Number(r.profit) * 100) / 100,
    clvMean: r.clv_mean === null ? null : Math.round(Number(r.clv_mean) * 1e4) / 1e4,
  }));
}
