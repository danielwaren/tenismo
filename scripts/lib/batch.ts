import type { Client } from '../../src/lib/db';

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

/**
 * Parte un INSERT de una fila en las tres piezas necesarias para repetir su
 * tupla de valores: cabecera, tupla y cola (`on conflict ...`).
 *
 * La tupla puede mezclar marcadores y literales — `values (?, 'tennis-data',
 * ?, 1)` es la forma que usa la ingesta de cuotas. Repetirla tal cual es
 * correcto: los literales se repiten idénticos y cada `?` consume su propio
 * argumento.
 *
 * Devuelve null si no es un INSERT con una única tupla sin paréntesis
 * anidados (nada de subconsultas ni funciones dentro del VALUES): esas formas
 * se ejecutan como estaban.
 */
export function splitInsert(sql: string): { head: string; tuple: string; tail: string } | null {
  const m = /^(\s*insert\s+into[\s\S]*?\bvalues\s*)(\([^()]*\))([\s\S]*)$/i.exec(sql);
  if (!m) return null;
  return { head: m[1], tuple: m[2], tail: m[3] };
}

/** Marcadores `?` que consume una tupla. */
const countPlaceholders = (tuple: string) => (tuple.match(/\?/g) ?? []).length;

/** Tope de parámetros por sentencia en Postgres (65535); se deja margen. */
const MAX_BIND_PARAMS = 50_000;

/**
 * Agrupa sentencias INSERT IDÉNTICAS en una sola de varias filas.
 *
 * POR QUÉ. Turso mandaba el lote entero en una petición HTTP; Postgres cobra
 * un ida-y-vuelta por sentencia. El rastreo de Tennis Abstract genera ~72.000
 * inserts con el MISMO SQL y solo cambian los argumentos: de uno en uno son
 * ~40 min de pura latencia (medido: el job moría por timeout con el scraping
 * ya terminado). Agrupados en tuplas de varias filas son ~150 sentencias.
 *
 * Solo agrupa lo que es trivialmente seguro agrupar: sentencias consecutivas
 * con el SQL byte a byte idéntico y una única tupla de `?`. Cualquier otra
 * cosa se devuelve tal cual.
 */
export function coalesceInserts(
  stmts: { sql: string; args: unknown[] }[],
): { sql: string; args: unknown[] }[] {
  if (stmts.length < 2) return stmts;
  const parts = splitInsert(stmts[0].sql);
  if (!parts) return stmts;
  const cols = stmts[0].args.length;
  if (cols === 0) return stmts;
  // La tupla tiene que consumir EXACTAMENTE los argumentos de cada sentencia.
  // Si no cuadra, repetirla desalinearía los parámetros y se escribirían datos
  // en las columnas equivocadas: se deja sin agrupar.
  if (countPlaceholders(parts.tuple) !== cols) return stmts;
  if (!stmts.every((s) => s.sql === stmts[0].sql && s.args.length === cols)) return stmts;

  const maxRows = Math.max(1, Math.floor(MAX_BIND_PARAMS / cols));
  const out: { sql: string; args: unknown[] }[] = [];
  for (let i = 0; i < stmts.length; i += maxRows) {
    const rows = stmts.slice(i, i + maxRows);
    out.push({
      sql: `${parts.head}${new Array(rows.length).fill(parts.tuple).join(', ')}${parts.tail}`,
      args: rows.flatMap((r) => r.args),
    });
  }
  return out;
}

/**
 * ¿Es el error de agrupar dos filas con la MISMA clave de conflicto en una
 * sola sentencia? Postgres lo rechaza ("cannot affect row a second time"),
 * mientras que de una en una la segunda simplemente actualiza a la primera.
 * Cuando pasa, ese lote se reejecuta sentencia a sentencia.
 */
function isDuplicateConflictError(e: unknown): boolean {
  return /cannot affect row a second time/i.test(String((e as Error)?.message ?? e));
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
    const original = stmts.slice(i, i + chunk);
    let slice = coalesceInserts(original);

    let lastError: unknown;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        await client.batch(slice as any, 'write');
        lastError = undefined;
        break;
      } catch (e) {
        // Claves repetidas dentro del lote: se rehace sin agrupar, que sí las
        // admite (la segunda fila actualiza a la primera). No gasta intento:
        // si cayera en el último, el bucle saldría sin escribir NADA y sin
        // error — el lote se perdería en silencio. Solo puede pasar una vez,
        // porque después slice === original y la condición ya no se cumple.
        if (slice !== original && isDuplicateConflictError(e)) {
          slice = original;
          attempt--;
          continue;
        }
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
