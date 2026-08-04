/**
 * Aplica las migraciones de db/postgres en orden alfabético, una sola vez.
 *
 * Migrado a Postgres/Supabase (ago 2026, ver docs/12-migracion-supabase.md).
 * Las migraciones SQLite/Turso históricas (001..014) se quedan en
 * db/migrations/ como archivo — ya no se aplican, el esquema equivalente vive
 * consolidado en db/postgres/0001_initial_schema.sql.
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
const migrationsDir = join(here, '..', 'db', 'postgres');

/**
 * Parte un fichero en sentencias por ';', respetando bloques `$$...$$`
 * (cuerpos de función/trigger en PL/pgSQL o SQL, que llevan sus propios ';'
 * internos — partir a ciegas por ';' de fin de línea, como bastaba con
 * SQLite, corta la función en dos sentencias inválidas).
 */
function splitStatements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  let inString = false;

  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    const next2 = noComments.slice(i, i + 2);

    if (!inString && next2 === '$$') {
      inDollar = !inDollar;
      current += '$$';
      i++;
      continue;
    }
    if (!inDollar && ch === "'") inString = !inString;

    if (ch === ';' && !inDollar && !inString) {
      statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());

  return statements.filter((s) => s.length > 0);
}

async function main() {
  const client = db();

  await client.execute(`create table if not exists schema_migrations (
    name       text primary key,
    applied_at text not null default iso_now()
  )`);

  const applied = new Set(
    (await client.execute('select name from schema_migrations')).rows.map((r) => String(r.name)),
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);

    // Secuencial dentro de una transacción, NO client.batch(): batch prepara
    // todas las sentencias antes de ejecutar ninguna, así que un `insert` sobre
    // una tabla creada en el mismo fichero falla con "no existe la tabla".
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
  console.log(`Base: ${isLocalDb() ? 'SIN CONFIGURAR' : 'Supabase'} — ${process.env.SUPABASE_DB_HOST}`);
}

main().catch((e) => {
  console.error('Fallo al migrar:', e);
  process.exit(1);
});
