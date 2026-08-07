/**
 * Cuadro completo de un torneo, desde su página propia en tennisexplorer.com
 * (p.ej. /hagen-challenger/2026/atp-men/) — a diferencia de /matches/
 * (scripts/lib/tennis-explorer.ts), que solo da los partidos de UN día.
 *
 * LA PÁGINA ES UN DIBUJO, NO UNA TABLA. Cada ronda es una columna de divs con
 * posición absoluta (`left` fijo = la ronda, `top` = la fila dentro de ella).
 * No hay ninguna marca que diga "estos dos jugadores forman un partido": hay
 * que reconstruirlo.
 *
 * EL INVARIANTE EN EL QUE SE APOYA ESTO. La columna de una ronda NO repite el
 * resultado de SUS PROPIOS partidos — repite el de los de la ronda ANTERIOR,
 * uno por cada jugador que avanzó (nombre + marcador con el que ganó). Y el
 * orden de arriba a abajo de esos avances es el MISMO que el de sus partidos
 * en la columna anterior (el ganador del primer partido sale primero, el del
 * segundo después...). Así que NO hace falta leer coordenadas en píxeles para
 * emparejar — con el ORDEN basta: los jugadores 2k y 2k+1 de la columna
 * anterior son el partido k, y el ganador k de la columna siguiente dice
 * quién de los dos pasó y con qué marcador.
 *
 * Verificado contra el cuadro real de Hagen Challenger 2026 (32 cabezas de
 * serie, 5 rondas: 1. round → round of 16 → quarterfinal → semifinal →
 * final), con las rondas todavía sin terminar (columnas vacías al final).
 */

export interface DrawMatch {
  round: string;
  /** Ganador y perdedor, si el partido ya se jugó; null en un bye o un dato incompleto. */
  winner: string | null;
  loser: string | null;
  /** Marcador con el que ganó, tal cual lo publica la fuente. */
  score: string | null;
  sourceId: string | null;
}

export interface Draw {
  rounds: string[];
  matches: DrawMatch[];
}

/**
 * Descarga la página propia del torneo. `tournamentPath` es el id que ya usa
 * el resto del proyecto ("/hagen-challenger/2026/atp-men/") — la misma ruta
 * que enlaza la ficha del torneo en la fuente.
 */
export async function fetchDrawPage(tournamentPath: string): Promise<string> {
  const { TE_BASE, TE_USER_AGENT, assertAllowedPath } = await import('./tennis-explorer');
  assertAllowedPath(tournamentPath);
  const res = await fetch(`${TE_BASE}${tournamentPath}`, {
    headers: { 'User-Agent': TE_USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`tennisexplorer HTTP ${res.status}`);
  return res.text();
}

interface Entrada {
  left: number;
  top: number;
  tipo: 'jugador' | 'resultado';
  nombre?: string;
  sourceId?: string;
  score?: string;
}

const limpiarNombre = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/\s*\[[^\]]*\]\s*$/, '').trim();

/**
 * Cabeceras de ronda: divs centrados en `top: 0` de cada columna, con el
 * nombre de la ronda tal cual lo da la fuente ("1. round", "quarterfinal"…).
 */
function parseRoundHeaders(html: string): { left: number; name: string }[] {
  const out: { left: number; name: string }[] = [];
  const re = /left:\s*(\d+)px;\s*top:\s*0;[^>]*text-align:\s*center;[^>]*>([^<]*)<\/div>/g;
  for (const m of html.matchAll(re)) {
    const name = limpiarNombre(m[2]);
    if (name) out.push({ left: Number(m[1]), name });
  }
  return out.sort((a, b) => a.left - b.left);
}

function parseEntradas(html: string): Entrada[] {
  const out: Entrada[] = [];
  const reJugador = /<div style="([^"]*)"><a href="(\/player\/[^"]+)">([^<]+)<\/a>(\s*\[[^\]]*\])?<\/div>/g;
  for (const m of html.matchAll(reJugador)) {
    const left = Number((m[1].match(/left:\s*(\d+)px/) ?? [])[1]);
    const top = Number((m[1].match(/top:\s*(\d+)px/) ?? [])[1]);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    out.push({ left, top, tipo: 'jugador', nombre: limpiarNombre(m[3]) });
  }
  const reScore = /<div style="([^"]*)"><a href="(\/match-detail\/\?id=(\d+))">([^<]+)<\/a><\/div>/g;
  for (const m of html.matchAll(reScore)) {
    const left = Number((m[1].match(/left:\s*(\d+)px/) ?? [])[1]);
    const top = Number((m[1].match(/top:\s*(\d+)px/) ?? [])[1]);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    out.push({ left, top, tipo: 'resultado', sourceId: m[3], score: limpiarNombre(m[4]) });
  }
  return out;
}

/**
 * Reconstruye los partidos de UNA ronda a partir del orden, no de la
 * posición: `previos` son los N jugadores/avances de la ronda anterior
 * (en orden de arriba a abajo) y `avances` son los ganadores + marcador que
 * la fuente ya publicó para ESTA ronda.
 *
 * Empareja `previos[2k]` con `previos[2k+1]` como el partido k, y decide cuál
 * de los dos es el ganador comparando el nombre contra `avances[k]`. Si no
 * coincide con ninguno de los dos (dato inconsistente) o falta el marcador
 * (bye, o la ronda aún no se jugó del todo), el partido se omite en vez de
 * adivinar quién jugó contra quién.
 */
function emparejarRonda(
  roundName: string,
  previos: string[],
  avances: { nombre: string; score: string; sourceId: string }[],
): DrawMatch[] {
  const partidos: DrawMatch[] = [];
  for (let k = 0; k < avances.length; k++) {
    const par = [previos[2 * k], previos[2 * k + 1]];
    const avance = avances[k];
    if (!avance) continue;
    const [a, b] = par;
    let winner: string | null = null;
    let loser: string | null = null;
    if (a === avance.nombre) { winner = a; loser = b ?? null; }
    else if (b === avance.nombre) { winner = b; loser = a ?? null; }
    else { winner = avance.nombre; loser = null; } // no se pudo identificar al rival — no se adivina
    partidos.push({ round: roundName, winner, loser, score: avance.score, sourceId: avance.sourceId });
  }
  return partidos;
}

export function parseDraw(html: string): Draw {
  const headers = parseRoundHeaders(html);
  const entradas = parseEntradas(html);
  const matches: DrawMatch[] = [];

  for (let i = 1; i < headers.length; i++) {
    const colPrev = headers[i - 1].left;
    const colCurr = headers[i].left;

    const previos = entradas
      .filter((e) => e.left === colPrev && e.tipo === 'jugador')
      .sort((a, b) => a.top - b.top)
      .map((e) => e.nombre!);

    const avances = entradas
      .filter((e) => e.left === colCurr)
      .sort((a, b) => a.top - b.top)
      .reduce<{ nombre: string; score: string; sourceId: string }[]>((acc, e, idx, arr) => {
        // En esta columna se alternan jugador y resultado (top a top),
        // emparejados por posición: el resultado que sigue a un jugador es
        // el partido de la ronda ANTERIOR que ese jugador acaba de ganar.
        if (e.tipo !== 'jugador') return acc;
        const siguiente = arr[idx + 1];
        if (siguiente?.tipo === 'resultado') {
          acc.push({ nombre: e.nombre!, score: siguiente.score!, sourceId: siguiente.sourceId! });
        }
        return acc;
      }, []);

    // La ronda que se decide en esta transición es la ANTERIOR por nombre
    // (los avances resuelven los partidos de headers[i-1], no los de headers[i]).
    matches.push(...emparejarRonda(headers[i - 1].name, previos, avances));
  }

  return { rounds: headers.map((h) => h.name), matches };
}
