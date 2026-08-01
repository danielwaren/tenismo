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
import { findDuplicateGroups, type TournamentAgg } from '../src/lib/tournaments';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/**
 * Detecta torneos que son el mismo evento visto por dos fuentes y devuelve las
 * sentencias para unificarlos. El criterio (jugadores compartidos con fechas
 * solapadas) vive en src/lib/tournaments.ts, con sus tests.
 *
 * Solo mira las dos últimas temporadas: las viejas ya están consolidadas y
 * cargar todos los jugadores de 66.000 partidos para nada sería absurdo.
 */
async function fusionarTorneos(): Promise<{ sql: string; args: unknown[] }[]> {
  const client = db();
  const desdeTemporada = new Date().getUTCFullYear() - 1;

  const filas = (await client.execute({
    sql: `select tr.id, tr.tour_id, tr.season, tr.name, tr.surface, tr.series, tr.location,
                 min(m.played_on) desde, max(m.played_on) hasta, count(m.id) n
          from tournaments tr join matches m on m.tournament_id = tr.id
          where tr.season >= ? group by tr.id`,
    args: [desdeTemporada],
  })).rows;
  if (!filas.length) return [];

  const jugadores = new Map<number, Set<number>>();
  for (const r of (await client.execute({
    sql: `select tournament_id, p1_id, p2_id from matches m
          join tournaments tr on tr.id = m.tournament_id where tr.season >= ?`,
    args: [desdeTemporada],
  })).rows) {
    const id = Number(r.tournament_id);
    const s = jugadores.get(id) ?? new Set<number>();
    s.add(Number(r.p1_id));
    s.add(Number(r.p2_id));
    jugadores.set(id, s);
  }

  const aggs: TournamentAgg[] = filas.map((r) => ({
    id: Number(r.id),
    tourId: Number(r.tour_id),
    season: Number(r.season),
    name: String(r.name),
    surface: (r.surface as string | null) ?? null,
    series: (r.series as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    from: String(r.desde),
    to: String(r.hasta),
    matches: Number(r.n),
    players: jugadores.get(Number(r.id)) ?? new Set(),
  }));

  const { groups: grupos, skipped } = findDuplicateGroups(aggs);
  for (const s of skipped) {
    console.log(`  ! torneos ${s.ids[0]}/${s.ids[1]} ("${s.names[0]}" / "${s.names[1]}"): ${s.reason} — sin fusionar`);
  }
  if (!grupos.length) {
    console.log('  torneos duplicados: ninguno');
    return [];
  }

  const stmts: { sql: string; args: unknown[] }[] = [];
  for (const g of grupos) {
    const nombres = g.duplicates.map((d) => `"${d.name}"`).join(', ');
    console.log(`  torneos: ${nombres} → "${g.canonical.name}" (id ${g.canonical.id})`);

    for (const d of g.duplicates) {
      stmts.push({
        sql: 'update matches set tournament_id = ? where tournament_id = ?',
        args: [g.canonical.id, d.id],
      });
      // La fila que sobrevive se queda con los datos que solo tenía la otra: si
      // la superficie o la sede venían del duplicado, se pierden al borrarlo.
      stmts.push({
        sql: `update tournaments set
                surface  = coalesce(surface, ?),
                series   = coalesce(series, ?),
                location = coalesce(location, ?)
              where id = ?`,
        args: [d.surface, d.series, d.location, g.canonical.id],
      });
      stmts.push({ sql: 'delete from tournaments where id = ?', args: [d.id] });
    }
  }
  return stmts;
}

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');

  const programados = (await client.execute(`
    select id, tour_id, p1_id, p2_id, played_on
    from matches where status = 'scheduled'
  `)).rows;

  // Sin `return` aunque no haya nada que reconciliar: más abajo se retiran los
  // duplicados de ESPN y se fusionan los torneos, y esas dos cosas no dependen
  // de que hoy haya partidos programados. (Es el mismo fallo que tuvo train-elo:
  // salir antes de tiempo dejaba trabajo pendiente sin avisar.)
  if (!programados.length) console.log('No hay partidos programados que reconciliar.');
  else console.log(`Partidos programados: ${programados.length}`);

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

  // ── Torneos duplicados entre fuentes ───────────────────────────────────────
  // Va aquí y no en cada ingester porque son TRES los que crean torneos
  // (tennis-data, ESPN y The Odds API) y cada uno usa un nombre distinto para el
  // mismo evento. Resolverlo en un solo sitio, después de la ingesta, cubre a
  // los tres y también repara los duplicados que ya estaban en la base.
  stmts.push(...(await fusionarTorneos()));

  // La superficie está desnormalizada en `matches` porque el Elo y la
  // proyección de aces filtran por ella. ESPN no la publica, así que sus
  // partidos entran con null; si el torneo la sabe —normalmente porque acaba de
  // absorber la fila de otra fuente que sí la traía— se propaga aquí.
  const sinSuperficie = Number((await client.execute(`
    select count(*) n from matches m join tournaments tr on tr.id = m.tournament_id
    where m.surface is null and tr.surface is not null`)).rows[0].n);
  if (sinSuperficie) {
    console.log(`  superficie heredada del torneo: ${sinSuperficie} partidos`);
    stmts.push({
      sql: `update matches set surface = (select tr.surface from tournaments tr where tr.id = tournament_id)
            where surface is null
              and (select tr.surface from tournaments tr where tr.id = tournament_id) is not null`,
      args: [],
    });
  }

  if (dryRun) { console.log('--dry-run: no se ha escrito nada.'); return; }
  if (stmts.length) await runBatch(client, stmts, 'reconciliación');
  console.log('Reconciliación terminada.');
}

main().catch((e) => {
  console.error('Fallo al reconciliar:', e);
  process.exit(1);
});
