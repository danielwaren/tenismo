/**
 * Aplica las migraciones de db/migrations en orden alfabético, una sola vez.
 *
 * Sustituye al `supabase db push` del proyecto de fútbol: Turso no tiene CLI de
 * migraciones instalada aquí, así que el control de versiones del esquema vive
 * en una tabla propia (`schema_migrations`).
 *
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';

loadEnv();

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

async function main() {
  const client = db();

  await client.execute(`create table if not exists schema_migrations (
    name       text primary key,
    applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const applied = new Set(
    (await client.execute('select name from schema_migrations')).rows.map((r) => String(r.name)),
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // libSQL no ejecuta varias sentencias en un execute(); se parten por ';'
    // (el esquema no usa bloques con ';' interno — SQLite no tiene plpgsql).
    // Se quitan las líneas de comentario ANTES de decidir si el trozo está
    // vacío: si no, un bloque de comentarios pegado a una sentencia real hacía
    // que se descartara la sentencia entera.
    const statements = sql
      .split(/;\s*$/m)
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !/^\s*--/.test(line))
          .join('\n')
          .trim(),
      )
      .filter((s) => s.length > 0);

    // Secuencial dentro de una transacción, NO client.batch(): batch prepara
    // todas las sentencias antes de ejecutar ninguna, así que un `insert` sobre
    // una tabla creada en el mismo fichero falla con "no such table".
    const tx = await client.transaction('write');
    try {
      for (const stmt of statements) await tx.execute(stmt);
      await tx.execute({ sql: 'insert into schema_migrations (name) values (?)', args: [file] });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw new Error(`Migración ${file} revertida: ${(e as Error).message}`);
    }
    console.log(`  aplicada  ${file}  (${statements.length} sentencias)`);
    ran++;
  }

  console.log(
    ran === 0
      ? `Sin migraciones pendientes (${files.length} ya aplicadas).`
      : `${ran} migración(es) aplicadas.`,
  );
  console.log(`Base: ${isLocalDb() ? 'local (fichero)' : 'Turso'} — ${process.env.TURSO_DATABASE_URL}`);
}

main().catch((e) => {
  console.error('Fallo al migrar:', e);
  process.exit(1);
});
