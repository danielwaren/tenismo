/**
 * Sube los partidos CHALLENGER de `ta_matches` a las tablas principales.
 *
 *   npx tsx scripts/promote-challenger.ts --dry-run
 *   npx tsx scripts/promote-challenger.ts
 *
 * QUÉ CAMBIA Y POR QUÉ IMPORTA. Hasta ahora `ta_matches` era un almacén
 * aparte: Tennis Abstract se leía para sacar estadísticas de saque, pero NO
 * tocaba `matches` ni el Elo, porque tennis-data era la única fuente
 * autorizada de resultados. Esto rompe esa regla a propósito y por decisión
 * explícita: mete ~33.700 partidos Challenger en `matches` para que alimenten
 * el Elo. Consecuencias que hay que tener presentes:
 *
 *   · El Elo pasa a entrenarse sobre dos fuentes. Las métricas publicadas
 *     (calibración, backtest) dejan de ser comparables con las de antes.
 *   · Hace falta reentrenar entero: `npm run db:elo -- --reset`. El Elo es
 *     incremental y no sabe insertar partidos en mitad de la historia.
 *
 * AL CIRCUITO ATP, NO A UNO NUEVO. Un Challenger es tenis masculino
 * profesional y lo juegan los mismos jugadores que el circuito principal (994
 * de los que aparecen aquí YA están en `players`). Con un circuito
 * "Challenger" aparte, cada jugador tendría dos Elos independientes y sus
 * resultados Challenger no mejorarían ni una predicción ATP — que es
 * justamente para lo que sirven. El torneo queda marcado con
 * `series = 'Challenger'`, que es lo que permite distinguirlos.
 *
 * SOLO LO QUE NO ESTÁ YA. Se saltan las filas con `match_id`: ésas son
 * partidos que tennis-data ya publicó y que el enlace de ta-ingest reconoció.
 * Duplicarlos metería el mismo partido dos veces en el Elo.
 *
 * LIMITACIÓN CONOCIDA: la fecha. Tennis Abstract da la fecha de INICIO DEL
 * TORNEO, no la del partido (ver el comentario de parseScore en
 * src/lib/score.ts). Todos los partidos de un mismo Challenger entran con la
 * misma fecha, así que el Elo los procesa en orden arbitrario DENTRO del
 * torneo. No filtra información del futuro —ningún partido posterior influye
 * en uno anterior de otra semana— pero el orden interno de un cuadro no es el
 * real. Inventar fechas por ronda sería peor: sería inventarse el dato.
 */
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { buildIndex, candidateSlugs } from '../src/lib/players';
import { normalizeName, slugFromFullName, isRealPlayer } from '@tti/model';
import { parseScore } from '../src/lib/score';

loadEnv();

const hasFlag = (n: string) => process.argv.includes(`--${n}`);

/** Nivel de Tennis Abstract para Challenger. */
const CHALLENGER_LEVEL = 'C';

async function main() {
  const client = db();
  const dryRun = hasFlag('dry-run');

  const tourId = Number(
    (await client.execute("select id from tours where code = 'ATP'")).rows[0].id,
  );

  // ── Jugadores existentes ───────────────────────────────────────────────────
  const playerRows = (await client.execute({
    sql: 'select id, slug, name from players where tour_id = ?',
    args: [tourId],
  })).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name) }));
  const index = buildIndex(playerRows);
  const aliasRows = (await client.execute({
    sql: `select pa.slug, pa.player_id from player_aliases pa
          join players p on p.id = pa.player_id where p.tour_id = ?`,
    args: [tourId],
  })).rows;
  const aliases = new Map(aliasRows.map((r) => [String(r.slug), Number(r.player_id)]));

  const filas = (await client.execute({
    sql: `select ta_key, event, event_date, surface, round, best_of, score,
                 a_slug, a_name, a_player_id, b_slug, b_name, b_player_id, winner_slug
          from ta_matches
          where level = ? and match_id is null
          order by event_date, ta_key`,
    args: [CHALLENGER_LEVEL],
  })).rows;
  console.log(`Partidos Challenger sin enlazar: ${filas.length}`);

  // ── 1. Jugadores que faltan ────────────────────────────────────────────────
  // Se resuelve por el MISMO camino que el resto del proyecto (slug canónico y
  // alias); solo se crea el que no aparece por ninguna vía.
  const resolver = (fullName: string): number | null => {
    for (const slug of candidateSlugs(fullName)) {
      const porAlias = aliases.get(slug);
      if (porAlias !== undefined) return porAlias;
      const porSlug = index.bySlug.get(slug);
      if (porSlug !== undefined) return porSlug;
    }
    return null;
  };

  const nuevos = new Map<string, string>(); // slug -> nombre completo
  for (const f of filas) {
    for (const nombre of [String(f.a_name), String(f.b_name)]) {
      if (!isRealPlayer(nombre)) continue;
      if (resolver(nombre) !== null) continue;
      const slug = slugFromFullName(nombre);
      if (!slug) continue;
      if (!nuevos.has(slug)) nuevos.set(slug, nombre);
    }
  }
  console.log(`  jugadores nuevos a crear: ${nuevos.size}`);

  if (dryRun && nuevos.size) {
    // En seco los jugadores no se crean, pero el bucle de partidos de abajo los
    // necesita para poder contar algo real: se les da un id provisional. Sin
    // esto el --dry-run informaba de 0 partidos y 33.595 "sin resolver", que es
    // un artefacto del propio modo seco, no un diagnóstico.
    let falso = -1;
    for (const slug of nuevos.keys()) index.bySlug.set(slug, falso--);
  }

  if (!dryRun && nuevos.size) {
    await runBatch(
      client,
      [...nuevos].map(([slug, nombre]) => ({
        sql: `insert into players (tour_id, name, slug) values (?,?,?)
              on conflict (tour_id, slug) do nothing`,
        args: [tourId, nombre, slug],
      })),
      'jugadores',
    );
    // Se releen para tener sus ids reales.
    const nuevasFilas = (await client.execute({
      sql: 'select id, slug from players where tour_id = ?',
      args: [tourId],
    })).rows;
    index.bySlug.clear();
    index.bySurname.clear();
    for (const r of nuevasFilas) {
      const s = String(r.slug);
      index.bySlug.set(s, Number(r.id));
      const ape = s.split('-')[0];
      index.bySurname.set(ape, [...(index.bySurname.get(ape) ?? []), Number(r.id)]);
    }
  }

  // ── 2. Torneos ─────────────────────────────────────────────────────────────
  const trExistentes = new Map<string, number>(
    (await client.execute({
      sql: 'select id, name, season from tournaments where tour_id = ?',
      args: [tourId],
    })).rows.map((r) => [`${String(r.name)}|${Number(r.season)}`, Number(r.id)]),
  );

  const torneosNuevos = new Map<string, { name: string; season: number; surface: string | null }>();
  for (const f of filas) {
    const season = Number(String(f.event_date).slice(0, 4));
    const name = String(f.event);
    const key = `${name}|${season}`;
    if (trExistentes.has(key) || torneosNuevos.has(key)) continue;
    torneosNuevos.set(key, { name, season, surface: (f.surface as string | null) ?? null });
  }
  console.log(`  torneos nuevos a crear: ${torneosNuevos.size}`);

  if (dryRun && torneosNuevos.size) {
    let falso = -1;
    for (const key of torneosNuevos.keys()) trExistentes.set(key, falso--);
  }

  if (!dryRun && torneosNuevos.size) {
    await runBatch(
      client,
      [...torneosNuevos.values()].map((t) => ({
        sql: `insert into tournaments (tour_id, season, name, surface, series)
              values (?,?,?,?, 'Challenger')
              on conflict do nothing`,
        args: [tourId, t.season, t.name, t.surface],
      })),
      'torneos',
    );
    for (const r of (await client.execute({
      sql: 'select id, name, season from tournaments where tour_id = ?',
      args: [tourId],
    })).rows) {
      trExistentes.set(`${String(r.name)}|${Number(r.season)}`, Number(r.id));
    }
  }

  // ── 3. Partidos ────────────────────────────────────────────────────────────
  const matchStmts: { sql: string; args: unknown[] }[] = [];
  let sinResolver = 0;
  let sinMarcador = 0;

  for (const f of filas) {
    const aName = String(f.a_name);
    const bName = String(f.b_name);
    const aId = f.a_player_id !== null ? Number(f.a_player_id) : resolver(aName);
    const bId = f.b_player_id !== null ? Number(f.b_player_id) : resolver(bName);
    if (aId === null || bId === null || aId === bId) { sinResolver++; continue; }

    // El marcador viene con el GANADOR delante. Sin marcador utilizable no se
    // puede saber ni el resultado ni los sets: se descarta antes que inventar.
    const sets = parseScore(f.score as string | null);
    if (!sets) { sinMarcador++; continue; }

    const aGana = normalizeName(String(f.winner_slug)) === normalizeName(String(f.a_slug));
    const winnerId = aGana ? aId : bId;
    const loserId = aGana ? bId : aId;

    const p1 = Math.min(aId, bId);
    const p2 = Math.max(aId, bId);
    const wSets = sets.filter(([x, y]) => x > y).length;
    const lSets = sets.filter(([x, y]) => y > x).length;
    // sets_json va SIEMPRE con el ganador delante (misma convención que
    // ingest-history), y p1_won dice si ese ganador es p1.
    const season = Number(String(f.event_date).slice(0, 4));
    const trId = trExistentes.get(`${String(f.event)}|${season}`);
    if (trId === undefined) { sinResolver++; continue; }

    matchStmts.push({
      sql: `insert into matches
        (tour_id, tournament_id, season, played_on, round, best_of, surface, court,
         p1_id, p2_id, p1_won, winner_id, loser_id, w_sets, l_sets, sets_json,
         status, source, source_key)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'completed', 'tennis-abstract', ?)
        on conflict (source_key) do update set
          played_on = excluded.played_on, round = excluded.round,
          best_of = excluded.best_of, surface = excluded.surface,
          p1_won = excluded.p1_won, winner_id = excluded.winner_id,
          loser_id = excluded.loser_id, w_sets = excluded.w_sets,
          l_sets = excluded.l_sets, sets_json = excluded.sets_json,
          status = excluded.status`,
      args: [
        tourId, trId, season, String(f.event_date), f.round, f.best_of, f.surface, null,
        p1, p2, p1 === winnerId ? 1 : 0, winnerId, loserId, wSets, lSets,
        JSON.stringify(sets),
        `ta:${String(f.ta_key)}`,
      ],
    });
  }

  console.log(
    `  partidos a insertar: ${matchStmts.length}` +
      `  ·  sin resolver jugador/torneo: ${sinResolver}  ·  sin marcador: ${sinMarcador}`,
  );

  if (dryRun) {
    console.log('--dry-run: no se ha escrito nada.');
    return;
  }

  if (matchStmts.length) await runBatch(client, matchStmts, 'partidos challenger');

  // ── 4. Enlazar ta_matches con el partido recién creado ─────────────────────
  // Así las estadísticas de saque (match_stats) quedan disponibles para estos
  // partidos, que es lo que alimenta el motor punto a punto.
  const enlaces = (await client.execute(`
    update ta_matches set match_id = m.id, link_status = 'linked', updated_at = iso_now()
    from matches m
    where m.source_key = 'ta:' || ta_matches.ta_key and ta_matches.match_id is null
  `)).rowsAffected;
  console.log(`  ta_matches enlazados con su partido: ${enlaces}`);

  console.log(
    '\nHecho. AHORA HAY QUE REENTRENAR EL ELO ENTERO:\n' +
      '  npm run db:elo -- --reset\n' +
      'El Elo es incremental: sin --reset, estos partidos no entran en el histórico.',
  );
}

main().catch((e) => {
  console.error('Fallo al promover Challenger:', e);
  process.exit(1);
});
