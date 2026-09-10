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

/**
 * Red de seguridad para todo el proceso: un solo `unhandledRejection` sin
 * listener tumba el proceso Node entero (comportamiento por defecto desde
 * Node 15, `--unhandled-rejections=throw`) — no solo la petición que lo causó.
 *
 * Se observó en local (sandbox Windows): una query de `live.ts` cancelada por
 * el pooler de Supabase con "canceling statement due to statement timeout"
 * dejaba el server entero sin responder — hasta la ruta raíz `/`, que no toca
 * la base — y había que matar el proceso a mano. postgres.js tiene issues
 * abiertos consistentes con esto: promesas internas (fetch de tipos en
 * segundo plano, reconexión tras un cancel del pooler en modo transacción)
 * que rechazan sin que el código de la app pueda capturarlas —
 * github.com/porsager/postgres issues #279, #970, #1089.
 *
 * Esto no arregla la causa dentro de postgres.js, pero evita que un query
 * roto se lleve puesto TODO el proceso. Guardado en globalThis porque Vite en
 * dev recarga este módulo por HMR y `process` es el mismo proceso de principio
 * a fin — sin el guard se acumularía un listener nuevo por cada recarga.
 */
const globalForRejectionGuard = globalThis as unknown as { __ttiUnhandledRejectionGuard?: boolean };
if (!globalForRejectionGuard.__ttiUnhandledRejectionGuard) {
  globalForRejectionGuard.__ttiUnhandledRejectionGuard = true;
  process.on('unhandledRejection', (reason) => {
    console.error('[db] unhandledRejection no capturada (el proceso sigue vivo):', reason);
  });
}

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
    //
    // Override por env: `train-elo.ts` tiene una fase de CÓMPUTO larga (el
    // walk-forward + las simulaciones Markov de los programados) sin tocar la
    // base — si dura más de 10s, la conexión se cierra y la reapertura para
    // el batch de escritura a veces se cuelga contra el pooler de Supabase
    // (visto en local, sept 2026). Subir `SUPABASE_IDLE_TIMEOUT` para esas
    // corridas evita disparar ese camino. En un cron normal 10 está bien.
    idle_timeout: Number(process.env.SUPABASE_IDLE_TIMEOUT ?? 10),
    // Recicla cada conexión del pool cada 30 min aunque siga en uso. Defensa
    // contra conexiones que el pooler de Supabase (Supavisor, modo
    // transacción) da por muertas de su lado sin avisarle a postgres.js —
    // "medio abiertas": el cliente sigue esperando una respuesta que nunca
    // llega. Sin esto, una conexión así puede quedar colgada indefinidamente
    // (ver github.com/porsager/postgres#1089, #970).
    max_lifetime: 60 * 30,
    // Techo para EMPEZAR una conexión nueva (TCP + handshake TLS + auth), en
    // segundos. `statement_timeout` de abajo solo protege una vez que ya hay
    // conexión y el query está corriendo — esta fase de antes no tenía techo
    // ninguno. Reproducido en local (ago 2026): con el pool en mal estado tras
    // un cancel del pooler, una petición nueva se quedaba esperando una
    // conexión que nunca llegaba — no 8s, sino indefinidamente (varios
    // minutos, hasta matar el proceso a mano) — y como esto pasa ANTES de
    // cualquier query, se colgaba CUALQUIER ruta, no solo la que tocó el
    // problema originalmente (ver getLiveSnapshot en live.ts, que ya tiene su
    // propio techo de 20s por el mismo motivo, pero solo cubre esa función:
    // el resto de rutas de src/lib/queries.ts no pasan por ningún timeout
    // propio y dependían enteramente de este valor de postgres.js).
    connect_timeout: 8,
    // GUC de Postgres, va en el paquete de arranque de cada conexión nueva —
    // https://www.postgresql.org/docs/current/runtime-config-client.html.
    // Mismo techo de 8s que ya usan las llamadas HTTP externas del proyecto
    // (ver AbortController en challenger.ts): ningún query individual debe
    // poder colgar una conexión más que eso. Es la causa concreta que se vio
    // en local — "canceling statement due to statement timeout" — así que
    // fijarlo explícito (en vez de depender del límite que imponga Supabase
    // del otro lado) hace el comportamiento predecible y documentado acá.
    connection: { statement_timeout: 8_000 },
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
      // Una sentencia por ida-y-vuelta. Turso mandaba el lote entero en UNA
      // petición HTTP, así que esto es más lento por diseño: contra Supabase
      // cada lote cuesta (nº de sentencias × RTT). Medido: lanzarlas todas sin
      // await intermedio para que postgres.js las encole (pipelining) NO mejora
      // nada — 1,0x, el pooler en modo transacción las sirve igual de una en
      // una. No volver a intentarlo sin medir antes.
      //
      // Lo que sí funciona es mandar MENOS sentencias: scripts/lib/batch.ts
      // agrupa los inserts idénticos en tuplas de varias filas antes de llegar
      // aquí (medido: 300 inserts pasan de ~130 s a 0,8 s).
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
