/**
 * Fusiona los partidos PROGRAMADOS (de The Odds API) con su versión JUGADA
 * (de tennis-data), que llega días después.
 *
 *   npx tsx scripts/reconcile.ts
 *   npx tsx scripts/reconcile.ts --dry-run
 *
 * Sin esto, el mismo partido real existiría dos veces: una fila 'scheduled' con
 * las cuotas capturadas antes del cierre y otra 'completed' con el resultado.
 * Las apuestas simuladas apuntan a la primera y el resultado está en la segunda,
 * así que nunca se liquidarían.
 *
 * CRITERIO DE FUSIÓN, deliberadamente estricto: mismo circuito, misma PAREJA de
 * jugadores y fechas a menos de 3 días. No se casa por nombre ni por torneo,
 * porque los nombres de torneo difieren entre fuentes ("ATP Wimbledon" contra
 * "Wimbledon") y una fusión equivocada asignaría el resultado de un partido a
 * las cuotas de otro. Si un par jugó dos veces en esa ventana, se deja sin
 * fusionar para revisión manual: adivinar sería peor.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');

  const programados = (await client.execute(`
    select id, tour_id, p1_id, p2_id, played_on
    from matches where status = 'scheduled'
  `)).rows;

  if (!programados.length) { console.log('No hay partidos programados que reconciliar.'); return; }
  console.log(`Partidos programados: ${programados.length}`);

  const stmts: { sql: string; args: unknown[] }[] = [];
  let fusionados = 0;
  let ambiguos = 0;
  let sinJugar = 0;

  for (const p of programados) {
    const candidatos = (await client.execute({
      sql: `select id, played_on from matches
            where status = 'completed' and tour_id = ? and p1_id = ? and p2_id = ?
              and abs(julianday(played_on) - julianday(?)) <= 3`,
      args: [Number(p.tour_id), Number(p.p1_id), Number(p.p2_id), String(p.played_on)],
    })).rows;

    if (!candidatos.length) { sinJugar++; continue; }
    if (candidatos.length > 1) {
      console.log(`  ! partido ${p.id}: ${candidatos.length} coincidencias en la ventana — se deja sin fusionar`);
      ambiguos++;
      continue;
    }

    const destino = Number(candidatos[0].id);
    // Las cuotas capturadas antes del cierre se mueven a la fila definitiva:
    // son justamente las que permiten medir CLV.
    stmts.push({ sql: 'update odds set match_id = ? where match_id = ?', args: [destino, Number(p.id)] });
    stmts.push({ sql: 'update paper_trades set match_id = ? where match_id = ?', args: [destino, Number(p.id)] });
    // Las features y el pronóstico del programado se descartan: la fila jugada
    // tiene los suyos, calculados por train-elo con el estado correcto.
    stmts.push({ sql: 'delete from match_features where match_id = ?', args: [Number(p.id)] });
    stmts.push({ sql: 'delete from model_outputs where match_id = ?', args: [Number(p.id)] });
    stmts.push({ sql: 'delete from matches where id = ?', args: [Number(p.id)] });
    fusionados++;
  }

  console.log(`  fusionados ${fusionados} · aún sin jugar ${sinJugar} · ambiguos ${ambiguos}`);

  // Partidos COMPLETADOS de ESPN (solo-display) que tennis-data ya publicó de
  // forma autorizada: se borran los de ESPN para no duplicar el cuadro. Sus
  // cuotas/apuestas, si las hubiera, se mueven al partido de tennis-data.
  const espnDup = (await client.execute(`
    select e.id as espn_id, td.id as td_id
    from matches e
    join matches td on td.source = 'tennis-data' and td.status = 'completed'
      and td.tour_id = e.tour_id and td.p1_id = e.p1_id and td.p2_id = e.p2_id
      and abs(julianday(td.played_on) - julianday(e.played_on)) <= 3
    where e.source = 'espn' and e.status = 'completed'
  `)).rows;
  for (const r of espnDup) {
    const espnId = Number(r.espn_id), tdId = Number(r.td_id);
    stmts.push({ sql: 'update odds set match_id = ? where match_id = ?', args: [tdId, espnId] });
    stmts.push({ sql: 'update paper_trades set match_id = ? where match_id = ?', args: [tdId, espnId] });
    stmts.push({ sql: 'delete from matches where id = ?', args: [espnId] });
  }
  if (espnDup.length) console.log(`  duplicados ESPN→tennis-data retirados: ${espnDup.length}`);

  if (dryRun) { console.log('--dry-run: no se ha escrito nada.'); return; }
  if (stmts.length) await runBatch(client, stmts, 'reconciliación');
  console.log('Reconciliación terminada.');
}

main().catch((e) => {
  console.error('Fallo al reconciliar:', e);
  process.exit(1);
});
