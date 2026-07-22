import type { Client } from '@libsql/client';

/**
 * Ejecución de sentencias en lotes, con reintentos.
 *
 * Contra un fichero local esto sobraba, pero contra Turso una carga completa son
 * ~15 minutos de escrituras por red y los cortes transitorios son inevitables
 * (la primera ingesta real murió con ECONNRESET a mitad de los partidos).
 *
 * Reintentar es seguro porque TODAS las escrituras del proyecto son
 * idempotentes: upsert sobre `source_key`, `insert or replace` en features y
 * predicciones, `insert or ignore` en el resto. Repetir un lote no duplica nada.
 *
 * Solo se reintentan los fallos de RED. Un error de SQL (columna que no existe,
 * violación de restricción) no mejora esperando: se propaga de inmediato.
 */

const RETRIES = 5;
const BASE_DELAY_MS = 1000;

function isNetworkError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  // Los errores de SQL de libSQL vienen con código SQLITE_*: esos no se reintentan.
  if (/SQLITE_|no such (table|column)|constraint/i.test(msg)) return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|timeout|502|503|504/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BatchOptions {
  /** Sentencias por lote. Lotes muy grandes pesan más en la petición HTTP. */
  chunk?: number;
  /** Muestra progreso a partir de este número de sentencias. */
  progressAbove?: number;
}

export async function runBatch(
  client: Client,
  stmts: { sql: string; args: unknown[] }[],
  label: string,
  opts: BatchOptions = {},
): Promise<void> {
  const chunk = opts.chunk ?? 400;
  const progressAbove = opts.progressAbove ?? chunk * 4;
  const showProgress = stmts.length > progressAbove;

  for (let i = 0; i < stmts.length; i += chunk) {
    const slice = stmts.slice(i, i + chunk);

    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        await client.batch(slice as any, 'write');
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
        if (!isNetworkError(e) || attempt === RETRIES) throw e;
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        process.stdout.write(
          `\n  ! ${label}: fallo de red en ${i}/${stmts.length} ` +
            `(${String((e as Error)?.message ?? e).slice(0, 60)}). ` +
            `Reintento ${attempt}/${RETRIES - 1} en ${delay / 1000}s...\n`,
        );
        await sleep(delay);
      }
    }
    if (lastError) throw lastError;

    if (showProgress && (i / chunk) % 25 === 0) {
      process.stdout.write(`\r  ${label}: ${Math.min(i + chunk, stmts.length)}/${stmts.length}   `);
    }
  }
  if (showProgress) process.stdout.write(`\r  ${label}: ${stmts.length}/${stmts.length}   \n`);
}
