/**
 * Entrena el Elo por superficie recorriendo los partidos en orden cronológico.
 *
 *   npm run db:elo              # incremental: solo los partidos sin procesar
 *   npm run db:elo -- --reset   # borra ratings e historial y reentrena todo
 *
 * BACKTEST SIN LOOK-AHEAD (lección del proyecto de fútbol):
 * En cada partido se calcula y GUARDA la predicción con los ratings que había
 * ANTES de jugarse, y solo después se actualizan. Así `model_outputs` es un
 * backtest walk-forward legítimo: ninguna predicción vio su propio resultado.
 *
 * QUÉ ENTRA AL ENTRENAMIENTO:
 *   · Solo status='completed'. Las retiradas y los walkovers se excluyen porque
 *     el resultado no mide fuerza relativa (es el estándar en la literatura de
 *     Elo de tenis), pero se conservan en la base.
 *   · Los partidos sin superficie identificada actualizan solo el rating global.
 *
 * MOTOR PUNTO A PUNTO (markovLogit, ver packages/model/src/markov.ts): igual
 * patrón walk-forward que el Elo — se calcula con el perfil de saque previo al
 * partido y SOLO DESPUÉS se actualiza ese perfil con las estadísticas del
 * partido (si `match_stats` las tiene; la mayoría de partidos no las tiene,
 * y el perfil vacío degrada solo a la media del circuito). El perfil se
 * persiste en `player_serve_stats` / `tour_serve_stats` por la misma razón que
 * el Elo se persiste en `player_ratings`: sin eso, cada ejecución incremental
 * (el cron diario) reconstruiría el perfil desde cero y la feature saldría
 * neutral casi siempre en producción aunque funcione perfecto en un backtest.
 */
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch as runBatchWithRetry } from './lib/batch';
import {
  DEFAULT_ELO, predictMatch, updateRatings, effectiveElo, expectedWinProb,
  shrunkH2H, rankLogDiff, pointsLogDiff, loadDiff, intensityDiff, restDiff, formDiff,
  expDiff, bestOf5EloDiff, loadInWindow, daysSinceLast, recentForm,
  estimateServeProb, markovLogit, shrinkRate, DEFAULT_SERVE_KAPPA,
  type Rating, type Surface, type RecentMatch, type PointCount,
} from '@tti/model';

loadEnv();

const CHUNK = 400;
/** Partidos recientes que se conservan por jugador (suficiente para fatiga y forma). */
const HISTORY_KEEP = 30;
/** Versión bajo la que se guarda la predicción de Elo puro (línea base). */
export const ELO_VERSION = 'tennis-elo-surface-1.0.0';
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/**
 * Challenger y circuito pre-2013 de Tennis Abstract (ver scripts/backtest-elo-ta.ts,
 * que comparó esto contra la línea base antes de activarlo: Brier ATP
 * 0.2228→0.2219, WTA sin cambio — es ATP-only, TA-WTA no está en el proyecto).
 *
 * Solo se aplican en un `--reset`: mezclarlos en una pasada incremental
 * rompería el orden cronológico (un Challenger de hace años que HOY se
 * resuelve por primera vez no puede insertarse después del rating ya
 * calculado con partidos de 2026). Un reset ya recorre todo desde cero, así
 * que ahí sí se puede intercalar correctamente por fecha.
 */
const TA_LEVELS = ['G', 'M', 'A', 'C'];
const TA_LEVEL_SERIES: Record<string, string> = {
  G: 'grand slam', M: 'masters 1000', A: 'default', C: 'challenger',
};
const TA_ROUND_TO_ENGLISH: Record<string, string> = {
  Q1: 'Qualifying', Q2: 'Qualifying', Q3: 'Qualifying',
  R128: '1st Round', R64: '2nd Round', R32: '3rd Round', R16: '4th Round',
  QF: 'Quarterfinals', SF: 'Semifinals', BR: 'Semifinals', F: 'The Final', RR: 'Round Robin',
};
/** Orden dentro del mismo torneo: `ta_matches.event_date` es el inicio del
 * torneo, no la fecha del partido, así que todas las rondas comparten fecha. */
const ROUND_ORDER: Record<string, number> = {
  Qualifying: 0, '1st Round': 1, '2nd Round': 2, '3rd Round': 3,
  '4th Round': 4, 'Round Robin': 4, Quarterfinals: 5, Semifinals: 6, 'The Final': 7,
};

interface PlayerState {
  all: Rating;
  bySurface: Map<string, Rating>;
  /** Ventana reciente para fatiga, descanso y forma. */
  history: RecentMatch[];
  /** Puntos ganados/jugados al saque y al resto, acumulado walk-forward. */
  serve: { serveWon: number; servePoints: number; returnWon: number; returnPoints: number };
}

/** Media del circuito al servicio, antes de tener NINGUNA muestra propia. */
const DEFAULT_TOUR_SERVE_RATE = 0.62;
/** Cuánto se resiste la media global a moverse con muestras pequeñas al principio. */
const TOUR_AVG_KAPPA = 2000;

/** Juegos totales disputados en un partido, a partir del marcador por set. */
function totalGames(setsJson: string | null): number {
  if (!setsJson) return 0;
  try {
    const sets = JSON.parse(setsJson) as [number, number][];
    return sets.reduce((a, [w, l]) => a + (Number(w) || 0) + (Number(l) || 0), 0);
  } catch {
    return 0;
  }
}

const runBatch = (stmts: { sql: string; args: unknown[] }[], label: string) =>
  runBatchWithRetry(db(), stmts, label, { chunk: CHUNK });

async function main() {
  const client = db();
  const reset = hasFlag('reset');
  console.log(`Base: ${isLocalDb() ? 'local (fichero)' : 'Turso'} — ${process.env.TURSO_DATABASE_URL}`);

  if (reset) {
    console.log('Reset: borrando ratings, historial y predicciones previas...');
    await client.execute('delete from rating_history');
    await client.execute('delete from player_ratings');
    await client.execute('delete from model_outputs');
    await client.execute('delete from match_features');
    await client.execute('delete from player_serve_stats');
    await client.execute("update tour_serve_stats set serve_won = 0, serve_points = 0 where id = 1");
    await client.execute('update matches set elo_applied = 0');
  }

  // Versión FIJA, no la de app_config. `app_config.model_version` significa
  // "el modelo que sirve la app", y fit-model lo cambia al ajuste con features;
  // si este script leyera de ahí, la segunda ejecución guardaría predicciones
  // de Elo puro bajo el nombre del modelo con features y las machacaría.
  const modelVersion = ELO_VERSION;

  // ── Estado inicial de los ratings ──────────────────────────────────────────
  const state = new Map<number, PlayerState>();
  const blank = (): PlayerState => ({
    all: { elo: DEFAULT_ELO.baseElo, matches: 0 },
    bySurface: new Map(),
    history: [],
    serve: { serveWon: 0, servePoints: 0, returnWon: 0, returnPoints: 0 },
  });
  const existing = await client.execute('select player_id, surface, elo, matches from player_ratings');
  for (const r of existing.rows) {
    const pid = Number(r.player_id);
    if (!state.has(pid)) state.set(pid, blank());
    const s = state.get(pid)!;
    const rating: Rating = { elo: Number(r.elo), matches: Number(r.matches) };
    if (r.surface === 'all') s.all = rating;
    else s.bySurface.set(String(r.surface), rating);
  }

  // Perfil de saque/resto acumulado, recargado igual que los ratings: sin esto
  // cada ejecución incremental partiría de cero y la feature saldría neutral.
  const existingServe = await client.execute(
    'select player_id, serve_won, serve_points, return_won, return_points from player_serve_stats',
  );
  for (const r of existingServe.rows) {
    const pid = Number(r.player_id);
    if (!state.has(pid)) state.set(pid, blank());
    state.get(pid)!.serve = {
      serveWon: Number(r.serve_won), servePoints: Number(r.serve_points),
      returnWon: Number(r.return_won), returnPoints: Number(r.return_points),
    };
  }
  let globalServeWon = 0;
  let globalServePoints = 0;
  {
    const g = (await client.execute('select serve_won, serve_points from tour_serve_stats where id = 1')).rows[0];
    if (g) { globalServeWon = Number(g.serve_won); globalServePoints = Number(g.serve_points); }
  }
  const tourServeRate = (): number =>
    globalServePoints > 0
      ? shrinkRate(globalServeWon / globalServePoints, globalServePoints, DEFAULT_TOUR_SERVE_RATE, TOUR_AVG_KAPPA)
      : DEFAULT_TOUR_SERVE_RATE;

  const get = (pid: number, surface: string | null): { all: Rating; surf: Rating } => {
    if (!state.has(pid)) state.set(pid, blank());
    const s = state.get(pid)!;
    if (!surface) return { all: s.all, surf: { elo: s.all.elo, matches: 0 } };
    if (!s.bySurface.has(surface)) {
      // Un jugador que estrena superficie parte de su rating GLOBAL, no de 1500:
      // ya sabemos algo de él. `matches: 0` hace que pese 0 hasta acumular
      // muestra, así que no introduce información falsa.
      s.bySurface.set(surface, { elo: s.all.elo, matches: 0 });
    }
    return { all: s.all, surf: s.bySurface.get(surface)! };
  };

  // ── Partidos pendientes, en orden cronológico estricto ─────────────────────
  // match_stats de p1/p2, si Tennis Abstract llegó a ese partido (la mayoría
  // no tiene: ver docs/09-diseno-pick1.md §1.5). serve_won se reconstruye como
  // first_won + second_won porque match_stats no guarda el total directamente.
  const pending = await client.execute(`
    select m.id, m.p1_id, m.p2_id, m.p1_won, m.surface, m.played_on, m.round, m.best_of,
           m.winner_id, m.winner_rank, m.loser_rank, m.winner_points, m.loser_points,
           m.sets_json, tr.series,
           sa.serve_points a_sv_pts, sa.first_won a_fw, sa.second_won a_sw,
           sb.serve_points b_sv_pts, sb.first_won b_fw, sb.second_won b_sw
    from matches m
    join tournaments tr on tr.id = m.tournament_id
    left join match_stats sa on sa.match_id = m.id and sa.player_id = m.p1_id
    left join match_stats sb on sb.match_id = m.id and sb.player_id = m.p2_id
    where m.elo_applied = 0 and m.status = 'completed' and m.p1_won is not null
      and m.source = 'tennis-data'
    order by m.played_on, m.id
  `);
  console.log(`Partidos a procesar: ${pending.rows.length}`);

  // Fusión cronológica con Challenger/TA — SOLO en --reset (ver comentario de
  // TA_LEVELS más arriba: fuera de un reset rompería el orden).
  type Row = Record<string, unknown>;
  interface ChronoItem { dateKey: string; roundOrder: number; real?: Row; ta?: Row }
  let chronological: ChronoItem[] = pending.rows.map((r) => ({
    dateKey: String(r.played_on),
    roundOrder: ROUND_ORDER[String(r.round ?? '')] ?? 3,
    real: r,
  }));
  if (reset) {
    const taRows = await client.execute({
      sql: `select event_date, round, level, surface, a_slug, b_slug, a_player_id, b_player_id, winner_slug
            from ta_matches
            where link_status = 'no_candidate' and level in (${TA_LEVELS.map(() => '?').join(',')})
              and a_player_id is not null and b_player_id is not null`,
      args: TA_LEVELS,
    });
    console.log(`Partidos de Challenger/TA a intercalar: ${taRows.rows.length}`);
    for (const r of taRows.rows) {
      const round = TA_ROUND_TO_ENGLISH[String(r.round)] ?? 'default';
      chronological.push({ dateKey: String(r.event_date), roundOrder: ROUND_ORDER[round] ?? 3, ta: { ...r, round } });
    }
    chronological.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.roundOrder - y.roundOrder));
  }
  // Sin partidos jugados nuevos NO se puede salir aquí: los partidos
  // programados siguen necesitando sus features y su pronóstico, y en un día
  // normal (sin resultados nuevos pero con calendario futuro) eso es justo lo
  // único que hay que hacer.

  const historyStmts: { sql: string; args: unknown[] }[] = [];
  const predictionStmts: { sql: string; args: unknown[] }[] = [];
  const featureStmts: { sql: string; args: unknown[] }[] = [];
  const appliedIds: number[] = [];
  const touched = new Set<number>();

  // Head-to-head acumulado. Clave: par ordenado de ids (+ superficie en el
  // segundo mapa). El contador guarda las victorias del jugador de id MENOR,
  // que es siempre p1 por construcción del esquema.
  const h2hAll = new Map<string, { low: number; high: number }>();
  const h2hSurf = new Map<string, { low: number; high: number }>();
  const pairKey = (a: number, b: number, surface?: string | null) =>
    `${Math.min(a, b)}:${Math.max(a, b)}${surface ? `:${surface}` : ''}`;

  // Último ranking oficial visto de cada jugador. Los partidos FUTUROS no traen
  // ranking (la fuente solo lo publica con el resultado), así que se arrastra el
  // último conocido: el ranking se mueve despacio y es mejor proxy que asumir
  // que ambos jugadores están igual de clasificados.
  const ultimoRank = new Map<number, { rank: number | null; points: number | null }>();

  for (const item of chronological) {
    if (item.ta) {
      // Partido de Challenger/TA: solo mueve el Elo (global y de superficie).
      // Sin match_id real no hay features, pronóstico, h2h, perfil de saque
      // ni marca de elo_applied que tocar — eso sigue siendo exclusivo de
      // `matches`/tennis-data.
      const t = item.ta;
      const p1 = Number(t.a_player_id);
      const p2 = Number(t.b_player_id);
      const p1Won = String(t.winner_slug) === String(t.a_slug);
      const surface = (t.surface as string | null)?.toLowerCase() ?? null;
      const series = TA_LEVEL_SERIES[String(t.level)] ?? 'default';
      const round = String(t.round);
      const playedOn = String(t.event_date);

      const a = get(p1, surface);
      const b = get(p2, surface);
      const st1 = state.get(p1)!;
      const st2 = state.get(p2)!;
      const beforeAll1 = a.all.elo, beforeAll2 = b.all.elo;
      const beforeSurf1 = a.surf.elo, beforeSurf2 = b.surf.elo;

      const next = updateRatings({
        p1Overall: a.all, p1Surface: a.surf, p2Overall: b.all, p2Surface: b.surf,
        p1Won, series, round,
      });
      st1.all = next.p1Overall;
      st2.all = next.p2Overall;
      if (surface) {
        st1.bySurface.set(surface, next.p1Surface);
        st2.bySurface.set(surface, next.p2Surface);
      }
      touched.add(p1);
      touched.add(p2);

      const hist = (pid: number, scope: string, before: number, after: number) =>
        historyStmts.push({
          sql: `insert into rating_history (player_id, surface, match_id, elo_before, elo_after, played_on)
                values (?, ?, null, ?, ?, ?)`,
          args: [pid, scope, Math.round(before * 100) / 100, Math.round(after * 100) / 100, playedOn],
        });
      hist(p1, 'all', beforeAll1, next.p1Overall.elo);
      hist(p2, 'all', beforeAll2, next.p2Overall.elo);
      if (surface) {
        hist(p1, surface, beforeSurf1, next.p1Surface.elo);
        hist(p2, surface, beforeSurf2, next.p2Surface.elo);
      }
      continue;
    }

    const row = item.real!;
    const matchId = Number(row.id);
    const p1 = Number(row.p1_id);
    const p2 = Number(row.p2_id);
    const p1Won = Number(row.p1_won) === 1;
    const surface = (row.surface as string | null) ?? null;
    const playedOn = String(row.played_on);
    const series = (row.series as string | null) ?? null;

    const round = (row.round as string | null) ?? null;
    const winnerId = Number(row.winner_id);
    const p1IsWinner = winnerId === p1;

    const a = get(p1, surface);
    const b = get(p2, surface);
    const st1 = state.get(p1)!;
    const st2 = state.get(p2)!;

    // 1) FEATURES con el estado PREVIO al partido. Los rankings vienen de la
    // fuente "a fecha de inicio del torneo", así que son información legítima.
    const rankP1 = Number(p1IsWinner ? row.winner_rank : row.loser_rank) || null;
    const rankP2 = Number(p1IsWinner ? row.loser_rank : row.winner_rank) || null;
    const ptsP1 = Number(p1IsWinner ? row.winner_points : row.loser_points) || null;
    const ptsP2 = Number(p1IsWinner ? row.loser_points : row.winner_points) || null;

    ultimoRank.set(p1, { rank: rankP1, points: ptsP1 });
    ultimoRank.set(p2, { rank: rankP2, points: ptsP2 });

    const hAll = h2hAll.get(pairKey(p1, p2)) ?? { low: 0, high: 0 };
    const hSurf = h2hSurf.get(pairKey(p1, p2, surface)) ?? { low: 0, high: 0 };

    const load1 = loadInWindow(st1.history, playedOn);
    const load2 = loadInWindow(st2.history, playedOn);
    const eloDiffSurface = (effectiveElo(a.all, a.surf) - effectiveElo(b.all, b.surf)) / 400;

    // Motor punto a punto, con el perfil de saque PREVIO al partido (st1.serve
    // / st2.serve todavía no se han actualizado con este resultado).
    const tourRate = tourServeRate();
    const paLocal = estimateServeProb(
      { won: st1.serve.serveWon, points: st1.serve.servePoints },
      { won: st2.serve.returnWon, points: st2.serve.returnPoints },
      { tourServeRate: tourRate },
    );
    const pbLocal = estimateServeProb(
      { won: st2.serve.serveWon, points: st2.serve.servePoints },
      { won: st1.serve.returnWon, points: st1.serve.returnPoints },
      { tourServeRate: tourRate },
    );

    const feats = {
      eloDiffSurface,
      eloDiffOverall: (a.all.elo - b.all.elo) / 400,
      rankLogDiff: rankLogDiff(rankP1, rankP2),
      pointsLogDiff: pointsLogDiff(ptsP1, ptsP2),
      h2h: shrunkH2H(hAll.low, hAll.high),
      h2hSurface: shrunkH2H(hSurf.low, hSurf.high),
      loadDiff: loadDiff(load1.matches, load2.matches),
      intensityDiff: intensityDiff(load1.games, load1.matches, load2.games, load2.matches),
      restDiff: restDiff(daysSinceLast(st1.history, playedOn), daysSinceLast(st2.history, playedOn)),
      formDiff: formDiff(recentForm(st1.history), recentForm(st2.history)),
      expDiff: expDiff(a.all.matches, b.all.matches),
      surfaceExpDiff: expDiff(a.surf.matches, b.surf.matches),
      bestOf5EloDiff: bestOf5EloDiff(eloDiffSurface, Number(row.best_of) || null),
      markovLogit: markovLogit(paLocal, pbLocal, Number(row.best_of) || null),
    };
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    featureStmts.push({
      sql: `insert into match_features
            (match_id, elo_diff_surface, elo_diff_overall, rank_log_diff, points_log_diff,
             h2h, h2h_surface, load_diff, intensity_diff, rest_diff, form_diff, exp_diff,
             surface_exp_diff, best_of5_elo_diff, markov_logit)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            on conflict (match_id) do update set
              elo_diff_surface = excluded.elo_diff_surface, elo_diff_overall = excluded.elo_diff_overall,
              rank_log_diff = excluded.rank_log_diff, points_log_diff = excluded.points_log_diff,
              h2h = excluded.h2h, h2h_surface = excluded.h2h_surface,
              load_diff = excluded.load_diff, intensity_diff = excluded.intensity_diff,
              rest_diff = excluded.rest_diff, form_diff = excluded.form_diff, exp_diff = excluded.exp_diff,
              surface_exp_diff = excluded.surface_exp_diff, best_of5_elo_diff = excluded.best_of5_elo_diff,
              markov_logit = excluded.markov_logit`,
      args: [
        matchId, r4(feats.eloDiffSurface), r4(feats.eloDiffOverall), r4(feats.rankLogDiff),
        r4(feats.pointsLogDiff), r4(feats.h2h), r4(feats.h2hSurface), r4(feats.loadDiff),
        r4(feats.intensityDiff), r4(feats.restDiff), r4(feats.formDiff), r4(feats.expDiff),
        r4(feats.surfaceExpDiff), r4(feats.bestOf5EloDiff), r4(feats.markovLogit),
      ],
    });

    // 2) PREDICCIÓN solo-Elo con el estado PREVIO al partido (sin look-ahead).
    const pred = predictMatch({
      surface: (surface ?? 'hard') as Surface,
      p1: { overall: a.all, surface: a.surf },
      p2: { overall: b.all, surface: b.surf },
    });
    predictionStmts.push({
      sql: `insert into model_outputs (match_id, model_version, prob_p1, prob_p2, confidence, explanation)
            values (?, ?, ?, ?, ?, ?)
            on conflict (match_id, model_version) do update set
              prob_p1 = excluded.prob_p1, prob_p2 = excluded.prob_p2,
              confidence = excluded.confidence, explanation = excluded.explanation`,
      args: [
        matchId, modelVersion,
        Math.round(pred.probP1 * 1e6) / 1e6,
        Math.round(pred.probP2 * 1e6) / 1e6,
        pred.confidence,
        JSON.stringify(pred.reasons),
      ],
    });

    // 3) ACTUALIZACIÓN con el resultado.
    const next = updateRatings({
      p1Overall: a.all, p1Surface: a.surf,
      p2Overall: b.all, p2Surface: b.surf,
      p1Won, series, round,
    });

    const s1 = st1;
    const s2 = st2;
    const beforeAll1 = a.all.elo, beforeAll2 = b.all.elo;
    const beforeSurf1 = a.surf.elo, beforeSurf2 = b.surf.elo;

    s1.all = next.p1Overall;
    s2.all = next.p2Overall;
    if (surface) {
      s1.bySurface.set(surface, next.p1Surface);
      s2.bySurface.set(surface, next.p2Surface);
    }

    // Ventana reciente: juegos disputados y sorpresa frente a la expectativa
    // previa. Alimenta fatiga y forma de los PRÓXIMOS partidos, nunca de este.
    const games = totalGames(row.sets_json as string | null);
    const expP1 = expectedWinProb(effectiveElo(a.all, a.surf), effectiveElo(b.all, b.surf));
    const pushHistory = (s: PlayerState, surprise: number) => {
      s.history.push({ date: playedOn, games, surprise });
      if (s.history.length > HISTORY_KEEP) s.history.shift();
    };
    pushHistory(s1, (p1Won ? 1 : 0) - expP1);
    pushHistory(s2, (p1Won ? 0 : 1) - (1 - expP1));

    // Perfil de saque/resto: se actualiza SOLO si el partido trae estadísticas
    // de Tennis Abstract para los dos jugadores (la mayoría no las trae). Si
    // faltan, el perfil se queda igual y el próximo partido de este jugador
    // seguirá viendo la misma muestra que este — correcto, no hay nada que
    // añadir. `serveWon` se reconstruye como 1ºs + 2ºs ganados: match_stats no
    // guarda el total directamente.
    const aSvPts = Number(row.a_sv_pts) || 0;
    const bSvPts = Number(row.b_sv_pts) || 0;
    if (aSvPts > 0 && bSvPts > 0) {
      const aWon = (Number(row.a_fw) || 0) + (Number(row.a_sw) || 0);
      const bWon = (Number(row.b_fw) || 0) + (Number(row.b_sw) || 0);
      s1.serve.serveWon += aWon; s1.serve.servePoints += aSvPts;
      s1.serve.returnWon += bSvPts - bWon; s1.serve.returnPoints += bSvPts;
      s2.serve.serveWon += bWon; s2.serve.servePoints += bSvPts;
      s2.serve.returnWon += aSvPts - aWon; s2.serve.returnPoints += aSvPts;
      globalServeWon += aWon + bWon;
      globalServePoints += aSvPts + bSvPts;
    }

    // Head-to-head acumulado para los próximos enfrentamientos del par.
    for (const [map, key] of [
      [h2hAll, pairKey(p1, p2)],
      [h2hSurf, pairKey(p1, p2, surface)],
    ] as const) {
      if (!surface && map === h2hSurf) continue;
      const rec = map.get(key) ?? { low: 0, high: 0 };
      if (p1Won) rec.low++; else rec.high++;
      map.set(key, rec);
    }

    touched.add(p1);
    touched.add(p2);

    const hist = (pid: number, scope: string, before: number, after: number) =>
      historyStmts.push({
        sql: `insert into rating_history (player_id, surface, match_id, elo_before, elo_after, played_on)
              values (?, ?, ?, ?, ?, ?)`,
        args: [pid, scope, matchId, Math.round(before * 100) / 100, Math.round(after * 100) / 100, playedOn],
      });
    hist(p1, 'all', beforeAll1, next.p1Overall.elo);
    hist(p2, 'all', beforeAll2, next.p2Overall.elo);
    if (surface) {
      hist(p1, surface, beforeSurf1, next.p1Surface.elo);
      hist(p2, surface, beforeSurf2, next.p2Surface.elo);
    }

    appliedIds.push(matchId);
  }

  // ── Partidos PROGRAMADOS ───────────────────────────────────────────────────
  // Llegados aquí, el estado en memoria (ratings, historial, head-to-head,
  // rankings) está al día. Es el momento natural para generar las features de
  // los partidos que todavía no se han jugado, sin duplicar la lógica.
  const programados = await client.execute(`
    select m.id, m.p1_id, m.p2_id, m.surface, m.played_on, m.best_of, tr.series
    from matches m
    join tournaments tr on tr.id = m.tournament_id
    where m.status = 'scheduled'
    order by m.played_on, m.id
  `);

  for (const row of programados.rows) {
    const matchId = Number(row.id);
    const p1 = Number(row.p1_id);
    const p2 = Number(row.p2_id);
    const surface = (row.surface as string | null) ?? null;
    const playedOn = String(row.played_on);

    const a = get(p1, surface);
    const b = get(p2, surface);
    const st1 = state.get(p1)!;
    const st2 = state.get(p2)!;
    const load1 = loadInWindow(st1.history, playedOn);
    const load2 = loadInWindow(st2.history, playedOn);
    const hAll = h2hAll.get(pairKey(p1, p2)) ?? { low: 0, high: 0 };
    const hSurf = h2hSurf.get(pairKey(p1, p2, surface)) ?? { low: 0, high: 0 };
    const r1 = ultimoRank.get(p1) ?? { rank: null, points: null };
    const r2 = ultimoRank.get(p2) ?? { rank: null, points: null };

    const eloDiffSurface = (effectiveElo(a.all, a.surf) - effectiveElo(b.all, b.surf)) / 400;
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

    // Perfil de saque ya al día (venimos de recorrer todo el histórico): sin
    // join a match_stats, a diferencia del bucle de arriba.
    const tourRateSched = tourServeRate();
    const paSched = estimateServeProb(
      { won: st1.serve.serveWon, points: st1.serve.servePoints },
      { won: st2.serve.returnWon, points: st2.serve.returnPoints },
      { tourServeRate: tourRateSched },
    );
    const pbSched = estimateServeProb(
      { won: st2.serve.serveWon, points: st2.serve.servePoints },
      { won: st1.serve.returnWon, points: st1.serve.returnPoints },
      { tourServeRate: tourRateSched },
    );

    featureStmts.push({
      sql: `insert into match_features
            (match_id, elo_diff_surface, elo_diff_overall, rank_log_diff, points_log_diff,
             h2h, h2h_surface, load_diff, intensity_diff, rest_diff, form_diff, exp_diff,
             surface_exp_diff, best_of5_elo_diff, markov_logit)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            on conflict (match_id) do update set
              elo_diff_surface = excluded.elo_diff_surface, elo_diff_overall = excluded.elo_diff_overall,
              rank_log_diff = excluded.rank_log_diff, points_log_diff = excluded.points_log_diff,
              h2h = excluded.h2h, h2h_surface = excluded.h2h_surface,
              load_diff = excluded.load_diff, intensity_diff = excluded.intensity_diff,
              rest_diff = excluded.rest_diff, form_diff = excluded.form_diff, exp_diff = excluded.exp_diff,
              surface_exp_diff = excluded.surface_exp_diff, best_of5_elo_diff = excluded.best_of5_elo_diff,
              markov_logit = excluded.markov_logit`,
      args: [
        matchId, r4(eloDiffSurface), r4((a.all.elo - b.all.elo) / 400),
        r4(rankLogDiff(r1.rank, r2.rank)), r4(pointsLogDiff(r1.points, r2.points)),
        r4(shrunkH2H(hAll.low, hAll.high)), r4(shrunkH2H(hSurf.low, hSurf.high)),
        r4(loadDiff(load1.matches, load2.matches)),
        r4(intensityDiff(load1.games, load1.matches, load2.games, load2.matches)),
        r4(restDiff(daysSinceLast(st1.history, playedOn), daysSinceLast(st2.history, playedOn))),
        r4(formDiff(recentForm(st1.history), recentForm(st2.history))),
        r4(expDiff(a.all.matches, b.all.matches)), r4(expDiff(a.surf.matches, b.surf.matches)),
        r4(bestOf5EloDiff(eloDiffSurface, Number(row.best_of) || null)),
        r4(markovLogit(paSched, pbSched, Number(row.best_of) || null)),
      ],
    });

    const pred = predictMatch({
      surface: (surface ?? 'hard') as Surface,
      p1: { overall: a.all, surface: a.surf },
      p2: { overall: b.all, surface: b.surf },
    });
    predictionStmts.push({
      sql: `insert into model_outputs (match_id, model_version, prob_p1, prob_p2, confidence, explanation)
            values (?, ?, ?, ?, ?, ?)
            on conflict (match_id, model_version) do update set
              prob_p1 = excluded.prob_p1, prob_p2 = excluded.prob_p2,
              confidence = excluded.confidence, explanation = excluded.explanation`,
      args: [
        matchId, modelVersion, Math.round(pred.probP1 * 1e6) / 1e6,
        Math.round(pred.probP2 * 1e6) / 1e6, pred.confidence, JSON.stringify(pred.reasons),
      ],
    });
  }
  if (programados.rows.length) {
    console.log(`Partidos programados con features y pronóstico: ${programados.rows.length}`);
  }

  // ── Persistencia ───────────────────────────────────────────────────────────
  await runBatch(featureStmts, 'features');
  await runBatch(predictionStmts, 'predicciones');
  await runBatch(historyStmts, 'historial');

  const ratingStmts: { sql: string; args: unknown[] }[] = [];
  for (const pid of touched) {
    const s = state.get(pid)!;
    const push = (scope: string, r: Rating) =>
      ratingStmts.push({
        sql: `insert into player_ratings (player_id, surface, elo, matches, updated_at)
              values (?, ?, ?, ?, iso_now())
              on conflict (player_id, surface) do update set
                elo = excluded.elo, matches = excluded.matches, updated_at = excluded.updated_at`,
        args: [pid, scope, Math.round(r.elo * 100) / 100, r.matches],
      });
    push('all', s.all);
    for (const [surface, r] of s.bySurface) push(surface, r);
  }
  await runBatch(ratingStmts, 'ratings');

  // Perfil de saque/resto, mismo patrón que los ratings: sin esto, la próxima
  // ejecución incremental (el cron diario) partiría de cero.
  const serveStmts: { sql: string; args: unknown[] }[] = [];
  for (const pid of touched) {
    const s = state.get(pid)!.serve;
    serveStmts.push({
      sql: `insert into player_serve_stats
              (player_id, serve_won, serve_points, return_won, return_points, updated_at)
            values (?, ?, ?, ?, ?, iso_now())
            on conflict (player_id) do update set
              serve_won = excluded.serve_won, serve_points = excluded.serve_points,
              return_won = excluded.return_won, return_points = excluded.return_points,
              updated_at = excluded.updated_at`,
      args: [pid, s.serveWon, s.servePoints, s.returnWon, s.returnPoints],
    });
  }
  await runBatch(serveStmts, 'perfil de saque');
  await client.execute({
    sql: 'update tour_serve_stats set serve_won = ?, serve_points = ? where id = 1',
    args: [globalServeWon, globalServePoints],
  });

  // Un UPDATE por id serían 64.000 sentencias; contra Turso eso es un minuto y
  // medio de ida y vuelta por red para algo que cabe en 130 sentencias.
  const MARK = 500;
  const markStmts: { sql: string; args: unknown[] }[] = [];
  for (let i = 0; i < appliedIds.length; i += MARK) {
    const ids = appliedIds.slice(i, i + MARK);
    markStmts.push({
      sql: `update matches set elo_applied = 1 where id in (${ids.map(() => '?').join(',')})`,
      args: ids,
    });
  }
  await runBatch(markStmts, 'marcar procesados');

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\nProcesados ${appliedIds.length} partidos, ${touched.size} jugadores con rating.`);
  const top = await client.execute(`
    select p.name, t.code as tour, r.elo, r.matches
    from player_ratings r
    join players p on p.id = r.player_id
    join tours t on t.id = p.tour_id
    where r.surface = 'all' and r.matches >= 20
    order by r.elo desc limit 10
  `);
  console.log('\nTop 10 Elo global (mín. 20 partidos):');
  for (const r of top.rows) {
    console.log(`  ${String(r.name).padEnd(22)} ${r.tour}  ${Number(r.elo).toFixed(0)}  (${r.matches} partidos)`);
  }
}

main().catch((e) => {
  console.error('\nFallo al entrenar:', e);
  process.exit(1);
});
