/**
 * Elo global "forma reciente": igual que `player_ratings.surface = 'all'`
 * pero solo con los partidos de los últimos 2 años, para separar quién está
 * fuerte AHORA de quién acumuló rating hace una década y ya no compite igual.
 *
 *   npm run db:elo:recent
 *
 * A diferencia de `train-elo.ts` esto NO es incremental: la ventana se mueve
 * cada día (un partido que hoy entra en los últimos 2 años, mañana puede
 * quedar fuera), así que cada ejecución recalcula desde cero con SOLO los
 * partidos dentro de la ventana. Con el histórico ya recortado a temporadas
 * recientes (ver docs/09-diseno-pick1.md) son unos pocos miles de partidos:
 * recomputar entero cada día es barato y evita el problema de "restar" la
 * contribución de un partido que caducó, que el Elo no sabe hacer.
 *
 * Es un rating de SOLO EXHIBICIÓN en la ficha del partido — no alimenta
 * `match_features` ni `model_outputs`. Mezclarlo con el modelo activo sería
 * un cambio de modelo real (hay que reajustar pesos y backtest), no algo que
 * se decide de pasada.
 */
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch as runBatchWithRetry } from './lib/batch';
import {
  DEFAULT_ELO, expectedWinProb, kFactor, matchWeight,
} from '@tti/model';

loadEnv();

const CHUNK = 400;
const WINDOW_YEARS = 2;
/** Ámbito bajo el que se guarda en `player_ratings` (comparte tabla con 'all'/'hard'/...). */
export const RECENT_SCOPE = 'recent2y';

const runBatch = (stmts: { sql: string; args: unknown[] }[], label: string) =>
  runBatchWithRetry(db(), stmts, label, { chunk: CHUNK });

async function main() {
  const client = db();
  console.log(`Base: ${isLocalDb() ? 'SIN CONFIGURAR' : 'Supabase'}`);

  const pending = await client.execute(`
    select m.p1_id, m.p2_id, m.p1_won, m.played_on, m.round, tr.series
    from matches m
    join tournaments tr on tr.id = m.tournament_id
    where m.status = 'completed' and m.p1_won is not null and m.source = 'tennis-data'
      and m.played_on::date >= (current_date - interval '${WINDOW_YEARS} years')::date
    order by m.played_on, m.id
  `);
  console.log(`Partidos en la ventana de ${WINDOW_YEARS} años: ${pending.rows.length}`);

  const state = new Map<number, { elo: number; matches: number }>();
  const get = (pid: number) => {
    if (!state.has(pid)) state.set(pid, { elo: DEFAULT_ELO.baseElo, matches: 0 });
    return state.get(pid)!;
  };

  for (const row of pending.rows) {
    const p1 = Number(row.p1_id);
    const p2 = Number(row.p2_id);
    const p1Won = Number(row.p1_won) === 1;
    const series = (row.series as string | null) ?? null;
    const round = (row.round as string | null) ?? null;

    const a = get(p1);
    const b = get(p2);
    const exp1 = expectedWinProb(a.elo, b.elo);
    const w = matchWeight(series, round);
    const score1 = p1Won ? 1 : 0;

    const k1 = kFactor(a.matches) * w;
    const k2 = kFactor(b.matches) * w;
    a.elo += k1 * (score1 - exp1);
    b.elo += k2 * ((1 - score1) - (1 - exp1));
    a.matches += 1;
    b.matches += 1;
  }

  // Recompute completo: borra el ámbito entero y reescribe solo lo que sigue
  // dentro de la ventana. Así un jugador que lleva 2 años sin jugar pierde
  // este rating en vez de arrastrar uno caducado.
  await client.execute(`delete from player_ratings where surface = '${RECENT_SCOPE}'`);
  const stmts: { sql: string; args: unknown[] }[] = [];
  for (const [pid, r] of state) {
    stmts.push({
      sql: `insert into player_ratings (player_id, surface, elo, matches, updated_at)
            values (?, ?, ?, ?, iso_now())`,
      args: [pid, RECENT_SCOPE, Math.round(r.elo * 100) / 100, r.matches],
    });
  }
  await runBatch(stmts, 'ratings recientes');

  console.log(`\nJugadores con rating de los últimos ${WINDOW_YEARS} años: ${state.size}`);
}

main().catch((e) => {
  console.error('\nFallo al entrenar el Elo reciente:', e);
  process.exit(1);
});
