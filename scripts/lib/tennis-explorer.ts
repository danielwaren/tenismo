/**
 * Challenger desde tennisexplorer.com.
 *
 * POR QUÉ ESTA FUENTE Y NO OTRA. El circuito Challenger no lo cubre ninguna de
 * las que ya usamos: ESPN solo expone `atp` y `wta` (el slug `atp-challenger`
 * responde 400) y tennis-data no lo publica. Las que sí lo tienen o cobran
 * (Sportradar) o prohíben el acceso automatizado — atptour.com y
 * tennislive.net bloquean por nombre a los agentes automáticos, y el segundo
 * prohíbe además su propia página de marcadores.
 *
 * tennisexplorer.com es la única gratuita cuyo robots.txt lo permite: solo
 * prohíbe /redirect/, /terms-of-use/ y /contact/. Se comprueba en
 * assertAllowedPath, igual que con Tennis Abstract.
 *
 * QUÉ DA Y QUÉ NO. `/matches/` está renderizada en servidor: trae los partidos
 * del día con su marcador set por set. NO es tiempo real — el directo de su
 * `/live/` lo pinta un widget JavaScript de terceros que no se puede leer sin
 * un navegador headless. Con el cron de 15 minutos, un partido aparece con su
 * marcador poco después de cada set. Es lo que hay gratis, y se rotula como
 * tal en la interfaz en vez de venderlo como directo.
 */

/** Rutas que el robots.txt de la fuente prohíbe. Verificado 2026-08-06. */
const DISALLOWED = ['/redirect/', '/terms-of-use/', '/contact/'];

export const TE_BASE = 'https://www.tennisexplorer.com';
export const TE_SOURCE = 'tennis-explorer';
/** Un agente identificable: si molesta, que sepan a quién bloquear. */
export const TE_USER_AGENT = 'tenismo/1.0 (+https://tenismo.vercel.app)';

/**
 * Corta si la ruta está prohibida por robots.txt. Misma guarda que en ta.ts:
 * una URL mal construida no debe convertirse en un acceso indebido silencioso.
 */
export function assertAllowedPath(path: string): void {
  const limpio = path.split('?')[0];
  for (const bad of DISALLOWED) {
    if (limpio.startsWith(bad)) {
      throw new Error(`Ruta prohibida por el robots.txt de tennisexplorer.com: ${path}`);
    }
  }
}

export interface TeMatch {
  /** Id del partido en la fuente (de /match-detail/?id=…). */
  sourceId: string;
  tournament: string;
  /** Slug del torneo en la fuente, estable entre días. */
  tournamentSlug: string;
  /** Hora de inicio publicada, "HH:MM" (hora de la fuente, CET). */
  time: string | null;
  player1: string;
  player2: string;
  /** Sets ganados por cada uno, si la fuente ya los publica. */
  setsP1: number | null;
  setsP2: number | null;
  /** Juegos por set, en orden. Longitudes iguales para los dos. */
  gamesP1: number[];
  gamesP2: number[];
  /**
   * `scheduled` sin ningún juego anotado; `live` con marcador pero sin sets
   * decididos; `completed` cuando la fuente ya declara un ganador.
   */
  status: 'scheduled' | 'live' | 'completed';
}

export interface TeTournament {
  slug: string;
  name: string;
  matches: TeMatch[];
}

const limpiar = (s: string) =>
  s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const numeroONull = (s: string): number | null => {
  const t = limpiar(s);
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
};

/**
 * Juegos de un set. El tie-break viene como `6<sup>4</sup>` (perdió el
 * desempate 4 puntos): los juegos son 6 y el superíndice son PUNTOS del
 * desempate, no juegos. Sin quitarlo, `limpiar` deja "6 4" y el set entero se
 * leía como nulo — que era peor que perder el detalle, porque un 7-6 acababa
 * anotado como 7-0.
 *
 * Se conservan solo los juegos, que es como el proyecto ya guarda los
 * marcadores en vivo de ESPN (live_scores, sets separados por espacios).
 */
function juegosDeSet(celda: string): number | null {
  return numeroONull(celda.replace(/<sup>[\s\S]*?<\/sup>/g, ''));
}

/** Celdas `<td class="score…">` de una fila, en orden. */
function celdasScore(fila: string): string[] {
  return [...fila.matchAll(/<td class="score[^"]*">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
}

/**
 * Analiza la tabla de `/matches/`.
 *
 * La estructura es: una fila `head flags` por torneo y, debajo, DOS filas por
 * partido (`id="rN"` y `id="rNb"`), una por jugador. Se emparejan por ese id,
 * que es la única atadura fiable: las clases (`one`, `two`, `fRow`, `bott`)
 * alternan por estética y no identifican nada.
 *
 * SOLO LAS FILAS `rN`. La página trae una segunda tabla, con ids `sN`, que es
 * la del DÍA ANTERIOR (lleva su propia pestaña con la fecha). Mezclarlas
 * duplicaría torneos y metería resultados de ayer como si fueran de hoy.
 */
export function parseMatchesPage(html: string): TeTournament[] {
  const torneos: TeTournament[] = [];
  let actual: TeTournament | null = null;

  // Se recorre la tabla en orden, quedándose con cabeceras y filas de partido.
  const trozos = [...html.matchAll(/<tr(?:\s+id="(r\d+b?)")?[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)];
  const filasPorId = new Map<string, string>();
  for (const t of trozos) if (t[1]) filasPorId.set(t[1], t[3]);

  for (const t of trozos) {
    const [, id, clases, cuerpo] = t;

    if (clases.includes('head') && clases.includes('flags')) {
      const celda = cuerpo.match(/<td class="t-name"[^>]*>([\s\S]*?)<\/td>/);
      if (!celda) { actual = null; continue; }
      // Algunas cabeceras NO son enlace (p. ej. "Futures 2026", que agrupa
      // varios torneos ITF). Antes eso ponía `actual = null` y se tiraban en
      // silencio TODOS sus partidos: 96 de 163 en la página del 6-ago. Si no
      // hay enlace se usa el texto y se sintetiza el slug.
      const enlace = celda[1].match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const nombre = limpiar(enlace ? enlace[2] : celda[1]);
      if (!nombre) { actual = null; continue; }
      const slug = enlace ? enlace[1] : `sin-enlace:${nombre.toLowerCase().replace(/\s+/g, '-')}`;
      actual = { slug, name: nombre, matches: [] };
      torneos.push(actual);
      continue;
    }

    // Solo la PRIMERA fila de cada partido; la segunda se busca por su id + "b".
    if (!id || id.endsWith('b') || !actual) continue;
    const segunda = filasPorId.get(`${id}b`);
    if (!segunda) continue;

    const nombre = (fila: string) =>
      limpiar((fila.match(/<td class="t-name">([\s\S]*?)<\/td>/) ?? [])[1] ?? '')
        .replace(/\s*\(\d+\)\s*$/, ''); // quita el cabeza de serie: "(13)"
    const p1 = nombre(cuerpo);
    const p2 = nombre(segunda);
    if (!p1 || !p2) continue;

    const setsP1 = numeroONull((cuerpo.match(/<td class="result">([\s\S]*?)<\/td>/) ?? [])[1] ?? '');
    const setsP2 = numeroONull((segunda.match(/<td class="result">([\s\S]*?)<\/td>/) ?? [])[1] ?? '');

    // La cabecera del torneo aporta una celda score por columna (S,1,2,3,4,5),
    // pero en las filas de jugador son solo los juegos de cada set.
    const g1 = celdasScore(cuerpo).map(juegosDeSet);
    const g2 = celdasScore(segunda).map(juegosDeSet);
    const sets = Math.min(g1.length, g2.length);
    const gamesP1: number[] = [];
    const gamesP2: number[] = [];
    for (let i = 0; i < sets; i++) {
      // En cuanto un set no tiene los DOS marcadores, se acabó lo jugado: las
      // columnas restantes vienen vacías. Rellenar con 0 inventaría sets.
      if (g1[i] === null || g2[i] === null) break;
      gamesP1.push(g1[i]!);
      gamesP2.push(g2[i]!);
    }

    // La celda de la hora no es solo la hora: detrás puede venir un <br>, un
    // icono de TV y un <div class="streams"> entero con enlaces de afiliados de
    // casas de apuestas. Limpiar la celda y comparar con /^\d{1,2}:\d{2}$/
    // devolvía null en todos esos partidos. Se toma solo lo que hay ANTES de
    // la primera etiqueta.
    const celdaHora = (cuerpo.match(/<td class="first time"[^>]*>([\s\S]*?)<\/td>/) ?? [])[1] ?? '';
    const hora = (celdaHora.match(/^\s*(\d{1,2}:\d{2})/) ?? [])[1] ?? null;
    const sourceId = (cuerpo.match(/\/match-detail\/\?id=(\d+)/) ?? [])[1] ?? '';

    const status: TeMatch['status'] =
      setsP1 !== null && setsP2 !== null ? 'completed'
        : gamesP1.length > 0 ? 'live'
          : 'scheduled';

    actual.matches.push({
      sourceId, tournament: actual.name, tournamentSlug: actual.slug,
      time: hora,
      player1: p1, player2: p2, setsP1, setsP2, gamesP1, gamesP2, status,
    });
  }

  return torneos.filter((t) => t.matches.length > 0);
}

/** ¿Es un torneo del circuito Challenger? */
export function esChallenger(t: { name: string; slug: string }): boolean {
  return /challenger/i.test(t.name) || /challenger/i.test(t.slug);
}

/** Descarga la página de partidos del día. */
export async function fetchMatchesPage(path = '/matches/'): Promise<string> {
  assertAllowedPath(path);
  const res = await fetch(`${TE_BASE}${path}`, {
    headers: { 'User-Agent': TE_USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`tennisexplorer HTTP ${res.status}`);
  return res.text();
}
