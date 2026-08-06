/**
 * Rellena las fotos de jugador a partir de las fichas de Tennis Abstract YA
 * descargadas en data/raw/ta.
 *
 *   npx tsx scripts/backfill-photos.ts
 *   npx tsx scripts/backfill-photos.ts --dry-run
 *
 * NO PIDE NADA A LA RED. La ingesta diaria (ta-ingest) ya guarda la foto de
 * cada ficha que descarga, así que esto solo existe para no esperar semanas a
 * que el rastreo —limitado a 120 fichas al día por el Cloudflare de la
 * fuente— vuelva a pasar por jugadores que ya se leyeron.
 *
 * La atribución es obligatoria: extractPhoto devuelve URL, crédito y enlace
 * juntos o nada. Ver db/postgres/0002_player_photos.sql.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { loadEnv } from './lib/env';
import { runBatch } from './lib/batch';
import { extractPhoto, extractFullName, taSlug } from './lib/ta';

loadEnv();

const CACHE_DIR = join(process.cwd(), 'data', 'raw', 'ta');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const client = db();

  // slug -> id, para casar la ficha con el jugador de la base.
  const porSlug = new Map<string, number>();
  for (const r of (await client.execute('select id, slug from players')).rows) {
    porSlug.set(String(r.slug), Number(r.id));
  }

  let ficheros: string[];
  try {
    ficheros = readdirSync(CACHE_DIR).filter((f) => f.endsWith('.html'));
  } catch {
    console.log(`No hay caché en ${CACHE_DIR}: nada que rellenar.`);
    return;
  }

  // Una ficha por jugador: si hay varias fechas, gana la más reciente (el
  // nombre es {TaName}-{YYYY-MM-DD}.html, así que ordenar alfabéticamente
  // deja la última al final).
  const ultima = new Map<string, string>();
  for (const f of ficheros.sort()) {
    const taName = f.replace(/-\d{4}-\d{2}-\d{2}\.html$/, '');
    ultima.set(taName, f);
  }

  const stmts: { sql: string; args: unknown[] }[] = [];
  let sinFoto = 0;
  let sinJugador = 0;

  for (const fichero of ultima.values()) {
    const html = readFileSync(join(CACHE_DIR, fichero), 'utf8');
    const fullName = extractFullName(html);
    if (!fullName) continue;

    const playerId = porSlug.get(taSlug(fullName));
    if (!playerId) { sinJugador++; continue; }

    const foto = extractPhoto(html);
    if (!foto) { sinFoto++; continue; }

    stmts.push({
      sql: 'update players set photo_url = ?, photo_credit = ?, photo_credit_url = ? where id = ?',
      args: [foto.url, foto.credit, foto.creditUrl, playerId],
    });
  }

  console.log(`Fichas en caché: ${ultima.size}`);
  console.log(`  con foto:            ${stmts.length}`);
  console.log(`  sin foto en la ficha: ${sinFoto}`);
  console.log(`  sin jugador en base:  ${sinJugador}`);

  if (dryRun) { console.log('--dry-run: no se ha escrito nada.'); return; }
  if (stmts.length) await runBatch(client, stmts, 'fotos');
  console.log('Hecho.');
}

main().catch((e) => {
  console.error('Fallo al rellenar fotos:', e);
  process.exit(1);
});
