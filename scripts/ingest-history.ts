/**
 * Ingesta del histórico ATP/WTA desde tennis-data.co.uk a Turso/libSQL.
 *
 *   npm run db:ingest                  # 2013..año actual, ATP y WTA
 *   npm run db:ingest -- --from 2023
 *   npm run db:ingest -- --tour WTA --from 2025 --to 2025
 *   npm run db:ingest -- --force       # vuelve a descargar aunque haya caché
 *
 * Idempotente: los partidos entran con `insert or ignore` sobre `source_key`,
 * así que repetir la ingesta no duplica nada. Los ficheros descargados se
 * cachean en data/raw/ (ignorado por git).
 */
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { readXlsx } from './lib/xlsx';
import { parseSeason, seasonUrl, FIRST_XLSX_SEASON, type RawMatch } from './lib/tennis-data';

loadEnv();

const RAW_DIR = join(process.cwd(), 'data', 'raw');
const CHUNK = 400;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function download(tour: 'ATP' | 'WTA', season: number, force: boolean): Promise<string | null> {
  mkdirSync(RAW_DIR, { recursive: true });
  const dest = join(RAW_DIR, `${tour}-${season}.xlsx`);
  if (!force && existsSync(dest) && statSync(dest).size > 1000) return dest;

  const url = seasonUrl(tour, season);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ! ${tour} ${season}: HTTP ${res.status} en ${url} — se omite`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Un .xlsx es un ZIP: debe empezar por 'PK'. Si el servidor devuelve una
  // página de error con 200, esto lo caza antes de romper el parser.
  if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    console.warn(`  ! ${tour} ${season}: la respuesta no es un XLSX (${buf.length} bytes) — se omite`);
    return null;
  }
  writeFileSync(dest, buf);
  console.log(`  descargado ${tour} ${season} (${(buf.length / 1024).toFixed(0)} KB)`);
  return dest;
}

/** Ejecuta sentencias en lotes dentro de una transacción por lote. */
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
  const from = Number(arg('from', String(FIRST_XLSX_SEASON)));
  const to = Number(arg('to', String(new Date().getUTCFullYear())));
  const tourArg = arg('tour')?.toUpperCase();
  const tours: ('ATP' | 'WTA')[] = tourArg === 'ATP' || tourArg === 'WTA' ? [tourArg] : ['ATP', 'WTA'];
  const force = hasFlag('force');

  if (from < FIRST_XLSX_SEASON) {
    console.warn(
      `Aviso: las temporadas anteriores a ${FIRST_XLSX_SEASON} están en .xls (formato binario) y no se leen. Se empieza en ${FIRST_XLSX_SEASON}.`,
    );
  }
  const start = Math.max(from, FIRST_XLSX_SEASON);

  const client = db();
  console.log(`Base: ${isLocalDb() ? 'local (fichero)' : 'Turso'} — ${process.env.TURSO_DATABASE_URL}`);
  console.log(`Temporadas ${start}..${to}, circuitos ${tours.join(' + ')}\n`);

  // ── 1. Descarga y parseo ───────────────────────────────────────────────────
  const all: RawMatch[] = [];
  for (const tour of tours) {
    for (let season = start; season <= to; season++) {
      const file = await download(tour, season, force);
      if (!file) continue;
      const rows = await readXlsx(file, { dateHeaders: ['Date'] });
      const { matches, skipped, dateFixes } = parseSeason(rows, tour, season);
      all.push(...matches);
      const skipTxt = skipped.length ? `  (omitidas: ${skipped.map((s) => `${s.reason} ×${s.count}`).join(', ')})` : '';
      console.log(`  ${tour} ${season}: ${matches.length} partidos${skipTxt}`);
      for (const f of dateFixes) {
        console.log(`    ! errata de fecha en origen: ${f.tournament} (${f.round ?? '?'}) ${f.original} -> ${f.corrected}`);
      }
    }
  }
  if (!all.length) {
    console.log('\nNada que ingerir.');
    return;
  }
  console.log(`\nTotal parseado: ${all.length} partidos.`);

  const tourIds = new Map<string, number>(
    (await client.execute('select id, code from tours')).rows.map((r) => [String(r.code), Number(r.id)]),
  );

  // ── 2. Jugadores ───────────────────────────────────────────────────────────
  const players = new Map<string, { tour: string; slug: string; name: string }>();
  for (const m of all) {
    for (const [slug, name] of [[m.winnerSlug, m.winnerName], [m.loserSlug, m.loserName]] as const) {
      const key = `${m.tour}|${slug}`;
      // Se guarda el nombre visto más recientemente para esa identidad.
      if (!players.has(key)) players.set(key, { tour: m.tour, slug, name });
    }
  }
  await runBatch(
    [...players.values()].map((p) => ({
      sql: 'insert or ignore into players (tour_id, name, slug) values (?, ?, ?)',
      args: [tourIds.get(p.tour)!, p.name, p.slug],
    })),
    'jugadores',
  );
  const playerIds = new Map<string, number>(
    (await client.execute('select p.id, t.code, p.slug from players p join tours t on t.id = p.tour_id')).rows.map(
      (r) => [`${r.code}|${r.slug}`, Number(r.id)],
    ),
  );
  console.log(`  jugadores en base: ${playerIds.size}`);

  // ── 3. Torneos ─────────────────────────────────────────────────────────────
  const tournaments = new Map<string, RawMatch>();
  for (const m of all) {
    const key = `${m.tour}|${m.season}|${m.tournament}`;
    if (!tournaments.has(key)) tournaments.set(key, m);
  }
  await runBatch(
    [...tournaments.values()].map((m) => ({
      sql: `insert or ignore into tournaments (tour_id, season, name, location, series, surface, court)
            values (?, ?, ?, ?, ?, ?, ?)`,
      args: [tourIds.get(m.tour)!, m.season, m.tournament, m.location, m.series, m.surface, m.court],
    })),
    'torneos',
  );
  const tournamentIds = new Map<string, number>(
    (
      await client.execute(
        'select tr.id, t.code, tr.season, tr.name from tournaments tr join tours t on t.id = tr.tour_id',
      )
    ).rows.map((r) => [`${r.code}|${r.season}|${r.name}`, Number(r.id)]),
  );
  console.log(`  torneos en base: ${tournamentIds.size}`);

  // ── 4. Partidos ────────────────────────────────────────────────────────────
  // El orden p1/p2 NO depende del resultado: se ordena por id de jugador. Ver
  // la nota de db/migrations/001_schema.sql sobre la fuga de la variable objetivo.
  const matchStmts: { sql: string; args: unknown[] }[] = [];
  let sinJugador = 0;
  for (const m of all) {
    const wId = playerIds.get(`${m.tour}|${m.winnerSlug}`);
    const lId = playerIds.get(`${m.tour}|${m.loserSlug}`);
    const trId = tournamentIds.get(`${m.tour}|${m.season}|${m.tournament}`);
    if (!wId || !lId || !trId) { sinJugador++; continue; }

    const p1 = Math.min(wId, lId);
    const p2 = Math.max(wId, lId);
    // Upsert, no `insert or ignore`: la fuente corrige datos (erratas de fecha,
    // resultados rectificados) y esas correcciones deben propagarse. `p1_id` y
    // `p2_id` NO se tocan: son la identidad del partido.
    // Si al reingerir cambia algún resultado, hay que reentrenar con
    // `npm run db:elo -- --reset` (el Elo es incremental y no sabe deshacer).
    matchStmts.push({
      sql: `insert into matches
        (tour_id, tournament_id, season, played_on, round, best_of, surface, court,
         p1_id, p2_id, p1_won, winner_id, loser_id, winner_rank, loser_rank,
         winner_points, loser_points, w_sets, l_sets, sets_json, status, source, source_key)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        on conflict (source_key) do update set
          played_on = excluded.played_on, round = excluded.round, best_of = excluded.best_of,
          surface = excluded.surface, court = excluded.court, p1_won = excluded.p1_won,
          winner_id = excluded.winner_id, loser_id = excluded.loser_id,
          winner_rank = excluded.winner_rank, loser_rank = excluded.loser_rank,
          winner_points = excluded.winner_points, loser_points = excluded.loser_points,
          w_sets = excluded.w_sets, l_sets = excluded.l_sets,
          sets_json = excluded.sets_json, status = excluded.status`,
      args: [
        tourIds.get(m.tour)!, trId, m.season, m.playedOn, m.round, m.bestOf, m.surface, m.court,
        p1, p2, p1 === wId ? 1 : 0, wId, lId, m.winnerRank, m.loserRank,
        m.winnerPoints, m.loserPoints, m.wSets, m.lSets, JSON.stringify(m.sets),
        m.status, 'tennis-data', m.sourceKey,
      ],
    });
  }
  await runBatch(matchStmts, 'partidos');
  if (sinJugador) console.log(`  ! ${sinJugador} partidos omitidos por no resolver jugador/torneo`);

  // ── 5. Cuotas de cierre ────────────────────────────────────────────────────
  const matchByKey = new Map<string, { id: number; p1: number; winner: number }>(
    (await client.execute('select id, source_key, p1_id, winner_id from matches')).rows.map((r) => [
      String(r.source_key),
      { id: Number(r.id), p1: Number(r.p1_id), winner: Number(r.winner_id) },
    ]),
  );

  const oddsStmts: { sql: string; args: unknown[] }[] = [];
  for (const m of all) {
    const row = matchByKey.get(m.sourceKey);
    if (!row || !m.odds.length) continue;
    // La fuente da cuota de ganador/perdedor; hay que traducirla al orden p1/p2.
    const p1IsWinner = row.p1 === row.winner;
    for (const o of m.odds) {
      const p1Odds = p1IsWinner ? o.winner : o.loser;
      const p2Odds = p1IsWinner ? o.loser : o.winner;
      for (const [selection, value] of [['p1', p1Odds], ['p2', p2Odds]] as const) {
        oddsStmts.push({
          // Upsert sobre el índice parcial de cierre (ver migración 002): una
          // sola cuota de cierre por partido/casa/selección, actualizable.
          sql: `insert into odds
                (match_id, source, bookmaker, market, selection, odds, implied_prob, is_closing, captured_at)
                values (?, 'tennis-data', ?, 'match_winner', ?, ?, ?, 1, ?)
                on conflict (match_id, bookmaker, market, selection) where source = 'tennis-data'
                do update set odds = excluded.odds, implied_prob = excluded.implied_prob,
                              captured_at = excluded.captured_at`,
          args: [row.id, o.bookmaker, selection, value, Math.round((1 / value) * 10000) / 10000, m.playedOn],
        });
      }
    }
  }
  await runBatch(oddsStmts, 'cuotas');

  // ── Resumen ────────────────────────────────────────────────────────────────
  const q = async (sql: string) => Number((await client.execute(sql)).rows[0].n);
  console.log('\nEstado de la base:');
  console.log(`  jugadores           ${await q('select count(*) n from players')}`);
  console.log(`  torneos             ${await q('select count(*) n from tournaments')}`);
  console.log(`  partidos            ${await q('select count(*) n from matches')}`);
  console.log(`    completados       ${await q("select count(*) n from matches where status='completed'")}`);
  console.log(`    retirada/walkover ${await q("select count(*) n from matches where status in ('retired','walkover')")}`);
  console.log(`  cuotas de cierre    ${await q('select count(*) n from odds')}`);
  console.log(
    `  partidos con cuota  ${await q('select count(distinct match_id) n from odds')}`,
  );
}

main().catch((e) => {
  console.error('\nFallo en la ingesta:', e);
  process.exit(1);
});
