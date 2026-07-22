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
import { DEFAULT_ELO, predictMatch, updateRatings, type Rating, type Surface } from '@tti/model';

loadEnv();

const CHUNK = 400;
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

interface PlayerState {
  all: Rating;
  bySurface: Map<string, Rating>;
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
    await client.execute('update matches set elo_applied = 0');
  }

  const modelVersion = String(
    (await client.execute("select v from app_config where k = 'model_version'")).rows[0]?.v ??
      'tennis-elo-surface-1.0.0',
  );

  // ── Estado inicial de los ratings ──────────────────────────────────────────
  const state = new Map<number, PlayerState>();
  const existing = await client.execute('select player_id, surface, elo, matches from player_ratings');
  for (const r of existing.rows) {
    const pid = Number(r.player_id);
    if (!state.has(pid)) state.set(pid, { all: { elo: DEFAULT_ELO.baseElo, matches: 0 }, bySurface: new Map() });
    const s = state.get(pid)!;
    const rating: Rating = { elo: Number(r.elo), matches: Number(r.matches) };
    if (r.surface === 'all') s.all = rating;
    else s.bySurface.set(String(r.surface), rating);
  }

  const get = (pid: number, surface: string | null): { all: Rating; surf: Rating } => {
    if (!state.has(pid)) {
      state.set(pid, { all: { elo: DEFAULT_ELO.baseElo, matches: 0 }, bySurface: new Map() });
    }
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
    select m.id, m.p1_id, m.p2_id, m.p1_won, m.surface, m.played_on, tr.series
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
  const appliedIds: number[] = [];
  const touched = new Set<number>();

  for (const row of pending.rows) {
    const matchId = Number(row.id);
    const p1 = Number(row.p1_id);
    const p2 = Number(row.p2_id);
    const p1Won = Number(row.p1_won) === 1;
    const surface = (row.surface as string | null) ?? null;
    const playedOn = String(row.played_on);
    const series = (row.series as string | null) ?? null;

    const a = get(p1, surface);
    const b = get(p2, surface);

    // 1) PREDICCIÓN con el estado PREVIO al partido (sin look-ahead).
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

    // 2) ACTUALIZACIÓN con el resultado.
    const next = updateRatings({
      p1Overall: a.all, p1Surface: a.surf,
      p2Overall: b.all, p2Surface: b.surf,
      p1Won, series,
    });

    const s1 = state.get(p1)!;
    const s2 = state.get(p2)!;
    const beforeAll1 = a.all.elo, beforeAll2 = b.all.elo;
    const beforeSurf1 = a.surf.elo, beforeSurf2 = b.surf.elo;

    s1.all = next.p1Overall;
    s2.all = next.p2Overall;
    if (surface) {
      s1.bySurface.set(surface, next.p1Surface);
      s2.bySurface.set(surface, next.p2Surface);
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
