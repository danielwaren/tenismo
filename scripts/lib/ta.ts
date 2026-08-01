/**
 * Cliente y analizador de tennisabstract.com.
 *
 * Ver docs/09-diseno-pick1.md §1.5 para la verificación completa de la fuente.
 * Resumen de lo que hay que saber para tocar este fichero:
 *
 *  · La ficha ATP `cgi-bin/player-classic.cgi?p=NombreSinEspacios` trae los
 *    partidos INCRUSTADOS en el HTML, en un array `matchmx` de 48 columnas.
 *  · robots.txt prohíbe /jsfrags/, /jsmatches/ y /jsplayers/. NO prohíbe
 *    /cgi-bin/. `assertAllowedPath` impide que una futura "mejora" se salte eso.
 *  · La ficha WTA (`wplayer-classic.cgi`) carga los datos desde /jsmatches/,
 *    que sí está prohibido: por eso aquí solo hay ATP.
 *  · Cloudflare corta con `error code: 1015` a las ~6 peticiones seguidas.
 *  · TRAMPA GRAVE: un nombre desconocido NO da 404. Devuelve otro jugador con
 *    HTTP 200 — pedir `?p=ArynaSabalenka` (WTA) al endpoint ATP devolvió la
 *    ficha completa de Benoit Paire. Por eso `parsePlayerPage` compara el
 *    `fullname` declarado con el pedido y falla si no coinciden. Es el mismo
 *    patrón del default silencioso de `db()`: no falla, miente.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeName } from '@tti/model';

export const TA_ORIGIN = 'https://www.tennisabstract.com';
export const TA_SOURCE = 'tennis-abstract';

/** Rutas que robots.txt marca como Disallow (verificado 2026-07-31). */
const DISALLOWED = ['/jsfrags/', '/jsmatches/', '/jsplayers/'];

/**
 * Ritmo del rastreo. Cloudflare devuelve `error code: 1015` a ~6 peticiones
 * seguidas, así que 6 s entre peticiones (≈10 fichas/minuto) es lo que aguanta
 * sin cortes. Subirlo es tentador y es exactamente lo que provoca el bloqueo.
 */
export const TA_DELAY_MS = 6_000;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 15_000;

const USER_AGENT =
  'tennis-trader-intelligence/0.1 (proyecto personal de análisis; contacto vía github.com/danielwaren/tenismo)';

// ── Columnas de matchmx ──────────────────────────────────────────────────────
// Mapeo confirmado contra dos partidos reales:
//   Doha 2017 F, Djokovic-Murray 6-3 5-7 6-4 → 16+15 = 31 juegos al saque ✓
//   Wimbledon 2026 SF, Djokovic-Sinner 6-4 6-4 6-4 → 15+15 = 30 ✓,
//   Sinner afronta 1 break point y lo salva ✓
// Las columnas 16 (edad en filas antiguas, fecha de nacimiento en las nuevas),
// 19 y 39 cambian de significado o no se han identificado: NO se usan.
const COL = {
  eventDate: 0,     // ¡fecha de INICIO DEL TORNEO, no del partido!
  event: 1,
  surface: 2,
  level: 3,
  outcome: 4,       // 'W' | 'L', desde el punto de vista de la ficha
  ownRank: 5,
  round: 8,
  score: 9,         // del ganador: '6-3 5-7 6-4'
  bestOf: 10,
  oppName: 11,
  oppRank: 12,
  minutes: 20,
  ownStats: 21,     // 9 campos consecutivos
  oppStats: 30,     // 9 campos consecutivos
  mcpChartId: 40,
  eventId: 43,
  oppTaId: 47,
} as const;

const STATS_WIDTH = 9;
export const EXPECTED_WIDTH = 48;

export interface SideStats {
  ace: number | null;
  df: number | null;
  svpt: number | null;
  firstIn: number | null;
  firstWon: number | null;
  secondWon: number | null;
  svGms: number | null;
  bpSaved: number | null;
  bpFaced: number | null;
}

export interface TaSide {
  /** Slug canónico del proyecto ("bellucci-m"), derivado del nombre completo. */
  slug: string;
  fullName: string;
  rank: number | null;
  stats: SideStats;
}

export interface TaMatch {
  /** Clave simétrica: la misma se vea desde la ficha de A o la de B. */
  key: string;
  eventDate: string;   // 'YYYY-MM-DD' — inicio del torneo
  event: string;
  level: string | null;
  surface: string | null;
  round: string | null;
  bestOf: number | null;
  score: string | null;
  minutes: number | null;
  /** Lado A = slug menor, lado B = slug mayor. Nunca ganador/perdedor. */
  a: TaSide;
  b: TaSide;
  winnerSlug: string;
  mcpChartId: string | null;
  eventId: string | null;
  hasStats: boolean;
}

export interface TaPlayerPage {
  taName: string;
  fullName: string;
  matches: TaMatch[];
  /** Rivales vistos, para alimentar la bola de nieve. */
  opponents: { taName: string; fullName: string; taId: string | null }[];
}

// ── URL y guardas ────────────────────────────────────────────────────────────

/** Nombre tal cual va en la URL: sin espacios, sin acentos, sin puntuación. */
export function taNameFromFullName(fullName: string): string {
  return (fullName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '');
}

/**
 * Slug canónico del proyecto a partir del nombre completo de TA.
 *
 * No se usa `slugFromFullName` de @tti/model directamente porque esa heurística
 * asume que el primer token es el nombre de pila, y falla con los nombres
 * compuestos ("Juan Martin del Potro"). Aquí se devuelven todos los candidatos
 * y quien resuelve contra la base decide; este helper da solo el preferido,
 * para construir la clave simétrica de forma determinista.
 */
export function taSlug(fullName: string): string {
  const n = normalizeName(fullName);
  if (!n) return '';
  const parts = n.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(1).join(' ')}-${parts[0][0]}`;
}

export function playerUrl(taName: string): string {
  const path = `/cgi-bin/player-classic.cgi?p=${encodeURIComponent(taName)}`;
  assertAllowedPath(path);
  return TA_ORIGIN + path;
}

/**
 * Rechaza cualquier ruta que robots.txt prohíba. Está aquí y no en un comentario
 * porque la ruta prohibida (/jsmatches/) es más cómoda de parsear que la
 * permitida, así que la tentación de "optimizar" hacia ella es real.
 */
export function assertAllowedPath(path: string): void {
  for (const bad of DISALLOWED) {
    if (path.startsWith(bad)) {
      throw new Error(
        `Ruta prohibida por el robots.txt de Tennis Abstract: ${path}. ` +
          `Prohibidas: ${DISALLOWED.join(', ')}. Usa /cgi-bin/player-classic.cgi.`,
      );
    }
  }
}

// ── Analizador ───────────────────────────────────────────────────────────────

/** Extrae `var fullname = '...'` de la ficha. */
export function extractFullName(html: string): string | null {
  const m = html.match(/var\s+fullname\s*=\s*'([^']*)'/);
  return m ? m[1] : null;
}

/**
 * Recorta el literal `matchmx = [ ... ]` respetando las cadenas.
 *
 * Un `indexOf(']];')` ingenuo se pasa de largo: en la ficha hay más arrays
 * después y el JSON.parse falla con "unexpected non-whitespace". Este escáner
 * cuenta corchetes y salta lo que va entre comillas.
 */
export function extractMatchmx(html: string): string | null {
  const start = html.indexOf('matchmx = [');
  if (start < 0) return null;
  const open = html.indexOf('[', start);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }
  return null;
}

const num = (v: unknown): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

function readStats(row: string[], at: number): SideStats {
  const [ace, df, svpt, firstIn, firstWon, secondWon, svGms, bpSaved, bpFaced] = Array.from(
    { length: STATS_WIDTH },
    (_, i) => num(row[at + i]),
  );
  return { ace, df, svpt, firstIn, firstWon, secondWon, svGms, bpSaved, bpFaced };
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. Devuelve null si no tiene esa forma. */
export function isoDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * ¿Tiene el partido estadísticas utilizables?
 *
 * `svpt` a null o 0 significa que la fuente no las publica para ese partido
 * (ITF Futures y Challengers anteriores a ~2021). No es un error: es cobertura
 * que no existe, y se registra como tal en vez de rellenarse con ceros.
 */
function hasUsableStats(a: SideStats, b: SideStats): boolean {
  return !!(a.svpt && b.svpt && a.svpt > 0 && b.svpt > 0);
}

/**
 * Analiza una ficha de jugador.
 *
 * `expectedTaName` es obligatorio: sin él no se puede detectar que la web ha
 * devuelto a otro jugador, que es el fallo silencioso más peligroso de esta
 * fuente. Ver la cabecera del fichero.
 */
export function parsePlayerPage(html: string, expectedTaName: string): TaPlayerPage {
  const fullName = extractFullName(html);
  if (!fullName) {
    throw new Error(`La respuesta de ${expectedTaName} no contiene "var fullname" (¿página de error?)`);
  }

  const got = taNameFromFullName(fullName).toLowerCase();
  const want = taNameFromFullName(expectedTaName).toLowerCase();
  if (got !== want) {
    throw new Error(
      `Tennis Abstract devolvió OTRO jugador: se pidió "${expectedTaName}" y la ficha declara ` +
        `"${fullName}". La web responde 200 con un jugador cualquiera cuando el nombre no existe; ` +
        `NO se ingiere nada de esta respuesta.`,
    );
  }

  const literal = extractMatchmx(html);
  if (!literal) throw new Error(`No se encontró matchmx en la ficha de ${expectedTaName}`);

  let rows: string[][];
  try {
    rows = JSON.parse(literal);
  } catch (e) {
    throw new Error(`matchmx de ${expectedTaName} no es JSON válido: ${(e as Error).message}`);
  }

  const ownSlug = taSlug(fullName);
  const matches: TaMatch[] = [];
  const opponents = new Map<string, { taName: string; fullName: string; taId: string | null }>();

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < EXPECTED_WIDTH) continue;

    const eventDate = isoDate(row[COL.eventDate]);
    const oppName = str(row[COL.oppName]);
    if (!eventDate || !oppName) continue;

    const oppSlug = taSlug(oppName);
    if (!oppSlug || oppSlug === ownSlug) continue;

    const oppTaName = taNameFromFullName(oppName);
    if (oppTaName) opponents.set(oppTaName, { taName: oppTaName, fullName: oppName, taId: str(row[COL.oppTaId]) });

    const own: TaSide = {
      slug: ownSlug,
      fullName,
      rank: num(row[COL.ownRank]),
      stats: readStats(row, COL.ownStats),
    };
    const opp: TaSide = {
      slug: oppSlug,
      fullName: oppName,
      rank: num(row[COL.oppRank]),
      stats: readStats(row, COL.oppStats),
    };

    const wonByOwner = String(row[COL.outcome] ?? '').toUpperCase() === 'W';
    // Orden por slug, nunca por resultado: así las dos visitas a este partido
    // (la ficha de cada jugador) producen exactamente la misma fila.
    const ownIsA = ownSlug < oppSlug;
    const a = ownIsA ? own : opp;
    const b = ownIsA ? opp : own;

    const round = str(row[COL.round]);
    matches.push({
      key: [eventDate, 'ATP', a.slug, b.slug, round ?? '-'].join('|'),
      eventDate,
      event: str(row[COL.event]) ?? '(sin torneo)',
      level: str(row[COL.level]),
      surface: str(row[COL.surface]),
      round,
      bestOf: num(row[COL.bestOf]),
      score: str(row[COL.score]),
      minutes: num(row[COL.minutes]),
      a,
      b,
      winnerSlug: wonByOwner ? ownSlug : oppSlug,
      mcpChartId: str(row[COL.mcpChartId]),
      eventId: str(row[COL.eventId]),
      hasStats: hasUsableStats(a.stats, b.stats),
    });
  }

  return { taName: expectedTaName, fullName, matches, opponents: [...opponents.values()] };
}

// ── Descarga ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Es un corte transitorio (Cloudflare, 429, 5xx) que mejora esperando? */
function isThrottled(status: number, body: string): boolean {
  return status === 429 || status >= 500 || /error code: 101\d/.test(body);
}

export interface FetchOptions {
  /** Directorio de caché en disco. La caché es por jugador y día. */
  cacheDir?: string;
  /** Ignora la caché y vuelve a pedir. */
  force?: boolean;
  /** Espera antes de la petición (0 para la primera del lote). */
  delayMs?: number;
}

/**
 * Descarga la ficha, con caché diaria en disco y reintentos ante el límite de
 * ritmo. La caché no es un lujo: una ficha son hasta 775 KB y volver a pedirla
 * durante una depuración es lo que dispara el bloqueo de Cloudflare.
 */
export async function fetchPlayerPage(taName: string, opts: FetchOptions = {}): Promise<string> {
  const cacheDir = opts.cacheDir;
  const today = new Date().toISOString().slice(0, 10);
  const cacheFile = cacheDir ? join(cacheDir, `${taName}-${today}.html`) : null;

  if (cacheFile && !opts.force && existsSync(cacheFile)) {
    return readFileSync(cacheFile, 'utf8');
  }

  const url = playerUrl(taName);
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) {
      if (opts.delayMs) await sleep(opts.delayMs);
    } else {
      const wait = BACKOFF_BASE_MS * 2 ** (attempt - 2);
      console.warn(`    ! ${taName}: ${lastError} — reintento ${attempt - 1}/${MAX_RETRIES - 1} en ${wait / 1000}s`);
      await sleep(wait);
    }

    let status = 0;
    let body = '';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
      status = res.status;
      body = await res.text();
    } catch (e) {
      lastError = `fallo de red (${(e as Error).message.slice(0, 60)})`;
      continue;
    }

    if (isThrottled(status, body)) {
      lastError = status === 200 ? 'límite de ritmo de Cloudflare (1015)' : `HTTP ${status}`;
      continue;
    }
    if (status !== 200) throw new Error(`${taName}: HTTP ${status}`);
    // Una ficha real pesa cientos de KB; una página de error, un par de miles.
    if (body.length < 5_000) throw new Error(`${taName}: respuesta demasiado corta (${body.length} bytes)`);

    if (cacheFile) {
      mkdirSync(cacheDir!, { recursive: true });
      writeFileSync(cacheFile, body, 'utf8');
    }
    return body;
  }

  throw new Error(`${taName}: agotados los reintentos — ${lastError}`);
}

// ── Comparación de marcadores (para enlazar con nuestros partidos) ───────────

/**
 * Normaliza un marcador a lista de juegos [ganador, perdedor] por set.
 *
 * Hace falta porque la columna 0 de TA es la fecha de INICIO DEL TORNEO, no la
 * del partido: en un Grand Slam eso son hasta dos semanas de margen, demasiado
 * para emparejar solo por fecha. El marcador es el discriminante fuerte.
 * Los desempates entre paréntesis se descartan: 7-6(4) → [7,6].
 */
export function parseScore(score: string | null): [number, number][] | null {
  if (!score) return null;
  const sets: [number, number][] = [];
  for (const chunk of score.trim().split(/\s+/)) {
    const m = chunk.match(/^(\d+)-(\d+)/);
    if (!m) continue; // 'RET', 'W/O', 'Def.'
    sets.push([Number(m[1]), Number(m[2])]);
  }
  // En una retirada antes de empezar el set, TA escribe el set a cero
  // ("6-3 0-0 RET") y tennis-data simplemente no lo anota. Sin quitarlo, ningún
  // partido con abandono llega a emparejarse.
  while (sets.length > 1 && sets[sets.length - 1][0] === 0 && sets[sets.length - 1][1] === 0) sets.pop();
  return sets.length ? sets : null;
}

/** ¿Describen el mismo partido dos marcadores, ambos con el ganador delante? */
export function sameScore(a: string | null, b: string | null): boolean {
  const sa = parseScore(a);
  const sb = parseScore(b);
  if (!sa || !sb || sa.length !== sb.length) return false;
  return sa.every(([x, y], i) => sb[i][0] === x && sb[i][1] === y);
}
