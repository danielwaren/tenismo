import postgres from 'postgres';

/**
 * Cliente Postgres (Supabase) — SOLO SERVIDOR.
 *
 * Migrado desde Turso/libSQL (ago 2026): Turso bloqueó la cuenta por cuota de
 * lecturas dos veces en dos días (500M filas/mes, límite duro). Supabase free
 * no tiene ese tipo de tope — ver docs/12-migracion-supabase.md para el porqué
 * completo y qué se evaluó antes (D1, Neon).
 *
 * COMPATIBILIDAD DELIBERADA: este módulo expone la MISMA forma que tenía
 * @libsql/client — `execute()`/`batch()`/`transaction()`, con un `ResultSet`
 * que da `rows`/`rowsAffected`/`lastInsertRowid` — para que las ~40 consultas
 * ya escritas en el resto del proyecto seguuieran funcionando sin reescribir
 * cada una. Por debajo usa `postgres.js` con `sql.unsafe()`, que acepta SQL
 * con marcadores `$1,$2...`; aquí se traduce automáticamente desde el `?`
 * posicional que usaba el código para SQLite/libSQL.
 *
 * Sin RLS: el control de acceso sigue viviendo en las rutas API de Astro,
 * igual que con Turso — la contraseña de Postgres no sale del servidor.
 */

// ── Tipos compatibles con @libsql/client (lo que el resto del proyecto espera) ──

export interface ResultSet {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  lastInsertRowid?: number;
}

export type InArgs = unknown[];
export type InStatement = string | { sql: string; args?: InArgs };

export interface Transaction {
  execute(stmt: InStatement): Promise<ResultSet>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Client {
  execute(stmt: InStatement): Promise<ResultSet>;
  batch(stmts: { sql: string; args?: InArgs }[], mode?: 'write' | 'read'): Promise<ResultSet[]>;
  transaction(mode?: 'write' | 'read'): Promise<Transaction>;
}

// ── Traducción SQLite/libSQL → Postgres ─────────────────────────────────────

/** `?, ?, ?` posicional (SQLite) → `$1, $2, $3` (Postgres). No toca los `?` dentro de cadenas literales. */
function toPositional(sqlText: string): string {
  let i = 0;
  let inStr = false;
  let out = '';
  for (let c = 0; c < sqlText.length; c++) {
    const ch = sqlText[c];
    if (ch === "'") inStr = !inStr;
    if (ch === '?' && !inStr) { out += `$${++i}`; continue; }
    out += ch;
  }
  return out;
}

/**
 * Un INSERT sencillo sin RETURNING se queda sin la id generada al volver —
 * en libSQL eso lo daba `lastInsertRowid`. Se le añade `returning *`
 * automáticamente (nunca `returning id`: hay tablas sin columna `id` —
 * `app_config`, `tour_serve_stats`, `paper_trading_config`, todas con PK
 * propia — y pedir esa columna ahí revienta con "column id does not
 * exist"; `*` es válido pase lo que pase). `toResultSet` solo lee `.id` si
 * de verdad vino en la fila.
 */
function withAutoReturning(sqlText: string): { text: string; addedReturning: boolean } {
  const trimmed = sqlText.trim();
  const isPlainInsert = /^insert\s+into\s+/i.test(trimmed) && !/\breturning\b/i.test(trimmed);
  if (!isPlainInsert) return { text: sqlText, addedReturning: false };
  return { text: `${trimmed.replace(/;\s*$/, '')} returning *`, addedReturning: true };
}

function toResultSet(raw: postgres.RowList<postgres.Row[]>, addedReturning: boolean): ResultSet {
  const rows = Array.from(raw) as Record<string, unknown>[];
  const rowsAffected = typeof raw.count === 'number' ? raw.count : rows.length;
  const lastInsertRowid =
    addedReturning && rows.length && rows[0].id !== undefined ? Number(rows[0].id as never) : undefined;
  return { rows, rowsAffected, lastInsertRowid };
}

function normalize(stmt: InStatement): { sql: string; args: InArgs } {
  return typeof stmt === 'string' ? { sql: stmt, args: [] } : { sql: stmt.sql, args: stmt.args ?? [] };
}

async function runOne(
  exec: (text: string, args: InArgs) => Promise<postgres.RowList<postgres.Row[]>>,
  stmt: InStatement,
): Promise<ResultSet> {
  const { sql: raw, args } = normalize(stmt);
  const { text, addedReturning } = withAutoReturning(raw);
  const result = await exec(toPositional(text), args);
  return toResultSet(result, addedReturning);
}

// ── Cliente ──────────────────────────────────────────────────────────────────

function ensureEnvLoaded(): void {
  if (process.env.SUPABASE_DB_HOST) return;
  const loader = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader !== 'function') return;
  try {
    loader('.env');
  } catch {
    /* sin .env (p.ej. Vercel): las variables ya vienen del entorno */
  }
}

let sqlClient: postgres.Sql | null = null;
let client: Client | null = null;

function getSql(): postgres.Sql {
  if (sqlClient) return sqlClient;
  ensureEnvLoaded();

  const host = process.env.SUPABASE_DB_HOST;
  if (!host) {
    throw new Error(
      'SUPABASE_DB_HOST no está definida. Hacen falta SUPABASE_DB_HOST/PORT/NAME/USER/PASSWORD ' +
        '(ver .env.example) — no hay base local de respaldo con Postgres.',
    );
  }

  sqlClient = postgres({
    host,
    port: Number(process.env.SUPABASE_DB_PORT ?? 6543),
    database: process.env.SUPABASE_DB_NAME ?? 'postgres',
    username: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: 'require',
    // El pooler de Supabase en modo transacción no soporta prepared statements
    // persistentes entre conexiones — cada `.unsafe()` ya es un statement suelto.
    prepare: false,
    // Sin esto, el socket queda abierto indefinidamente y ningún script de
    // scripts/*.ts termina solo tras su último query — process.exit(1) solo
    // se llama en el catch de error, nunca al terminar bien. Así estuvieron
    // TODOS los workflows de GitHub Actions colgados hasta el timeout del job
    // (30 min) desde que se migró de @libsql/client (que sí cierra solo) a
    // postgres.js: el trabajo real terminaba, pero el step nunca reportaba
    // éxito. 10s de inactividad es de sobra para el hueco entre queries de un
    // fetch a una API externa (ESPN, tennis-data) sin mantener el proceso vivo
    // después del último query real.
    idle_timeout: 10,
  });
  return sqlClient;
}

export function db(): Client {
  if (client) return client;
  const sql = getSql();

  client = {
    async execute(stmt) {
      return runOne((text, args) => sql.unsafe(text, args as postgres.ParameterOrJSON<never>[]), stmt);
    },

    async batch(stmts, _mode) {
      return sql.begin(async (tx) => {
        const out: ResultSet[] = [];
        for (const s of stmts) {
          out.push(await runOne((text, args) => tx.unsafe(text, args as postgres.ParameterOrJSON<never>[]), s));
        }
        return out;
      });
    },

    async transaction(_mode) {
      const conn = await sql.reserve();
      await conn.unsafe('BEGIN');
      let closed = false;
      return {
        async execute(stmt) {
          if (closed) throw new Error('Transacción ya cerrada (commit/rollback).');
          return runOne((text, args) => conn.unsafe(text, args as postgres.ParameterOrJSON<never>[]), stmt);
        },
        async commit() {
          if (closed) return;
          closed = true;
          await conn.unsafe('COMMIT');
          conn.release();
        },
        async rollback() {
          if (closed) return;
          closed = true;
          await conn.unsafe('ROLLBACK');
          conn.release();
        },
      };
    },
  };
  return client;
}

/**
 * ¿Faltan credenciales reales? (diagnóstico — antes distinguía Turso local de
 * remoto; con Postgres no hay "base local de fichero", así que aquí solo
 * avisa de configuración incompleta).
 */
export function isLocalDb(): boolean {
  return !process.env.SUPABASE_DB_HOST;
}
