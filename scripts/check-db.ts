/**
 * Comprueba que las credenciales de la base funcionan DE VERDAD.
 *
 *   npm run db:check
 *
 * Por qué existe: el paso "Comprobar que hay base configurada" de los workflows
 * solo mira que la variable no esté vacía. Un token caducado, invalidado, mal
 * copiado o de solo lectura pasa ese control y revienta después, en mitad de la
 * tubería y con un error de libSQL que no dice cuál de las cuatro cosas es.
 *
 * Este script separa los tres fallos que se confunden entre sí:
 *   · falta la variable        → caería a la base local sin avisar
 *   · el token no autentica    → HTTP 401 (invalidado, caducado o mal pegado)
 *   · el token es de solo lectura → lee pero no escribe
 *
 * NO imprime el token ni la URL completa. Se puede pegar su salida sin miedo.
 */
import { db, isLocalDb } from '../src/lib/db';
import { loadEnv } from './lib/env';

loadEnv();

const ok = (m: string) => console.log(`  [32mOK[0m    ${m}`);
const bad = (m: string) => console.log(`  [31mFALLA[0m ${m}`);

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  console.log('\nCredenciales de la base\n');

  if (!url) {
    bad('TURSO_DATABASE_URL no está definida.');
    console.log('        Sin ella, `db()` usa el fichero local file:./data/tennis.db.');
    console.log('        En un runner de CI ese fichero no existe: el job escribiría en el vacío.');
    process.exit(1);
  }
  // Solo el host: la URL no es secreta, pero no hace falta enseñarla entera.
  ok(`TURSO_DATABASE_URL apunta a ${new URL(url).hostname}`);

  if (isLocalDb()) {
    ok('Es una base local (fichero). No hace falta token.');
  } else if (!token) {
    bad('TURSO_AUTH_TOKEN vacía y la URL es remota: no se puede autenticar.');
    process.exit(1);
  } else {
    // Un JWT tiene tres partes separadas por punto. Si lo que hay no las tiene,
    // casi siempre es un copiado a medias o con comillas alrededor.
    const partes = token.split('.').length;
    if (partes !== 3) {
      bad(`TURSO_AUTH_TOKEN no parece un token completo (${partes} segmentos, se esperan 3).`);
      console.log('        Suele ser un copiado incompleto, o comillas pegadas alrededor del valor.');
    } else {
      ok(`TURSO_AUTH_TOKEN tiene forma de token (${token.length} caracteres)`);
    }
    if (token !== token.trim()) {
      bad('El token tiene espacios o saltos de línea al principio o al final.');
    }
  }

  // ── Lectura ────────────────────────────────────────────────────────────────
  const client = db();
  try {
    const n = Number((await client.execute('select count(*) n from matches')).rows[0].n);
    ok(`Lectura correcta (${n.toLocaleString('es-CL')} partidos)`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (/401/.test(msg)) {
      bad('HTTP 401: el token NO autentica.');
      console.log('\n        Causas, de más a menos frecuente:');
      console.log('         1. Es el token viejo. Si invalidaste, este ya no sirve.');
      console.log('         2. Creaste el token ANTES de invalidar: `turso db tokens invalidate`');
      console.log('            mata también los recién creados. Hay que crear DESPUÉS.');
      console.log('         3. Se copió a medias (son largos y la terminal los parte).');
      console.log('\n        Arreglo:  turso db tokens create tenismo');
    } else {
      bad(`No se pudo leer: ${msg.slice(0, 160)}`);
    }
    process.exit(1);
  }

  // ── Escritura ──────────────────────────────────────────────────────────────
  // Un token de solo lectura lee sin problema y falla al escribir. La tubería
  // muere entonces en "Migraciones", que es la primera escritura que hace.
  try {
    await client.execute('create table if not exists _check_escritura (x integer)');
    await client.execute('drop table if exists _check_escritura');
    ok('Escritura correcta');
  } catch (e) {
    bad(`El token lee pero NO escribe: ${String((e as Error).message).slice(0, 120)}`);
    console.log('        Es un token de solo lectura (--read-only). La ingesta necesita escribir.');
    console.log('        Arreglo:  turso db tokens create tenismo     (sin --read-only)');
    process.exit(1);
  }

  console.log('\nTodo correcto: estas credenciales sirven para la ingesta.\n');
}

main().catch((e) => {
  console.error('\nFallo inesperado al comprobar la base:', e);
  process.exit(1);
});
