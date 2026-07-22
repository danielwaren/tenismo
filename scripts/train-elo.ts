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
 */
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';
import {
  DEFAULT_ELO, predictMatch, updateRatings, effectiveElo, expectedWinProb,
  shrunkH2H, rankLogDiff, pointsLogDiff, loadDiff, intensityDiff, restDiff, formDiff,
  expDiff, bestOf5EloDiff, loadInWindow, daysSinceLast, recentForm,
  type Rating, type Surface, type RecentMatch,
} from '@tti/model';

loadEnv();

const CHUNK = 400;
/** Partidos recientes que se conservan por jugador (suficiente para fatiga y forma). */
const HISTORY_KEEP = 30;
/** Versión bajo la que se guarda la predicción de Elo puro (línea base). */
export const ELO_VERSION = 'tennis-elo-surface-1.0.0';
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

interface PlayerState {
  all: Rating;
  bySurface: Map<string, Rating>;
  /** Ventana reciente para fatiga, descanso y forma. */
  history: RecentMatch[];
}

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

async function runBatch(stmts: { sql: string; args: unknown[] }[], label: string) {
  const client = db();
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await client.batch(stmts.slice(i, i + CHUNK) as any, 'write');
    if (stmts.length > CHUNK * 4 && (i / CHUNK) % 25 === 0) {
      process.stdout.write(`\r  ${label}: ${Math.min(i + CHUNK, stmts.length)}/${stmts.length}   `);
    }
  }
  if (stmts.length > CHUNK * 4) process.stdout.write(`\r  ${label}: ${stmts.length}/${stmts.length}   \n`);
}

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
  const pending = await client.execute(`
    select m.id, m.p1_id, m.p2_id, m.p1_won, m.surface, m.played_on, m.round, m.best_of,
           m.winner_id, m.winner_rank, m.loser_rank, m.winner_points, m.loser_points,
           m.sets_json, tr.series
    from matches m
    join tournaments tr on tr.id = m.tournament_id
    where m.elo_applied = 0 and m.status = 'completed' and m.p1_won is not null
    order by m.played_on, m.id
  `);
  console.log(`Partidos a procesar: ${pending.rows.length}`);
  if (!pending.rows.length) {
    console.log('Nada que entrenar.');
    return;
  }

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

  for (const row of pending.rows) {
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

    const hAll = h2hAll.get(pairKey(p1, p2)) ?? { low: 0, high: 0 };
    const hSurf = h2hSurf.get(pairKey(p1, p2, surface)) ?? { low: 0, high: 0 };

    const load1 = loadInWindow(st1.history, playedOn);
    const load2 = loadInWindow(st2.history, playedOn);
    const eloDiffSurface = (effectiveElo(a.all, a.surf) - effectiveElo(b.all, b.surf)) / 400;

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
    };
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    featureStmts.push({
      sql: `insert or replace into match_features
            (match_id, elo_diff_surface, elo_diff_overall, rank_log_diff, points_log_diff,
             h2h, h2h_surface, load_diff, intensity_diff, rest_diff, form_diff, exp_diff,
             surface_exp_diff, best_of5_elo_diff)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        matchId, r4(feats.eloDiffSurface), r4(feats.eloDiffOverall), r4(feats.rankLogDiff),
        r4(feats.pointsLogDiff), r4(feats.h2h), r4(feats.h2hSurface), r4(feats.loadDiff),
        r4(feats.intensityDiff), r4(feats.restDiff), r4(feats.formDiff), r4(feats.expDiff),
        r4(feats.surfaceExpDiff), r4(feats.bestOf5EloDiff),
      ],
    });

    // 2) PREDICCIÓN solo-Elo con el estado PREVIO al partido (sin look-ahead).
    const pred = predictMatch({
      surface: (surface ?? 'hard') as Surface,
      p1: { overall: a.all, surface: a.surf },
      p2: { overall: b.all, surface: b.surf },
    });
    predictionStmts.push({
      sql: `insert or replace into model_outputs
            (match_id, model_version, prob_p1, prob_p2, confidence, explanation)
            values (?, ?, ?, ?, ?, ?)`,
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
              values (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              on conflict (player_id, surface) do update set
                elo = excluded.elo, matches = excluded.matches, updated_at = excluded.updated_at`,
        args: [pid, scope, Math.round(r.elo * 100) / 100, r.matches],
      });
    push('all', s.all);
    for (const [surface, r] of s.bySurface) push(surface, r);
  }
  await runBatch(ratingStmts, 'ratings');

  await runBatch(
    appliedIds.map((id) => ({ sql: 'update matches set elo_applied = 1 where id = ?', args: [id] })),
    'marcar procesados',
  );

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
