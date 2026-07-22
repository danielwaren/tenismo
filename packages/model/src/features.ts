/**
 * FEATURES DE PARTIDO — todo lo que el Elo por sí solo no ve.
 *
 * Regla que gobierna este fichero: cada feature se calcula EXCLUSIVAMENTE con
 * información disponible antes del saque inicial. El ranking oficial vale
 * porque la fuente lo da "a fecha de inicio del torneo"; la fatiga y la forma
 * miran solo partidos anteriores; el head-to-head excluye el partido en curso.
 *
 * Todas las features son DIFERENCIAS orientadas a p1: positivo = favorece a p1.
 * Así el modelo hereda la antisimetría del problema (si intercambias los
 * jugadores, la probabilidad debe ser 1-p).
 */

export const FEATURE_NAMES = [
  'eloDiffSurface',
  'eloDiffOverall',
  'rankLogDiff',
  'pointsLogDiff',
  'h2h',
  'h2hSurface',
  'loadDiff',
  'intensityDiff',
  'restDiff',
  'formDiff',
  'expDiff',
  'surfaceExpDiff',
  'bestOf5EloDiff',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

/** Rango que se asume para un jugador sin ranking oficial (fuera del top 1800). */
export const UNRANKED = 1800;

/** Vector a array en el orden canónico de FEATURE_NAMES. */
export function toArray(f: FeatureVector): number[] {
  return FEATURE_NAMES.map((n) => f[n]);
}

/**
 * Head-to-head encogido hacia 0. Sin el término del denominador, un único
 * enfrentamiento previo daría ±1 y pesaría igual que un 8-0.
 *   0 enfrentamientos -> 0   ·   1-0 -> +0.33   ·   8-0 -> +0.8
 */
export function shrunkH2H(winsP1: number, winsP2: number, prior = 2): number {
  const total = winsP1 + winsP2;
  if (total === 0) return 0;
  return (winsP1 - winsP2) / (total + prior);
}

/**
 * Ventaja por ranking oficial. Se usa el logaritmo porque la diferencia entre
 * el 1 y el 10 es enorme y la del 200 al 210 es irrelevante. Positivo = p1 mejor
 * clasificado (número más bajo).
 */
export function rankLogDiff(rankP1: number | null, rankP2: number | null): number {
  const r1 = rankP1 && rankP1 > 0 ? rankP1 : UNRANKED;
  const r2 = rankP2 && rankP2 > 0 ? rankP2 : UNRANKED;
  return Math.log(r2) - Math.log(r1);
}

/** Ventaja por puntos de ranking. Complementa al puesto: mide la distancia real. */
export function pointsLogDiff(ptsP1: number | null, ptsP2: number | null): number {
  const a = Math.max(0, ptsP1 ?? 0);
  const b = Math.max(0, ptsP2 ?? 0);
  return Math.log(a + 1) - Math.log(b + 1);
}

/**
 * CARGA reciente: número de partidos disputados en la ventana.
 *
 * Ojo con la interpretación. La primera versión de esta feature contaba juegos
 * totales y se ajustó con peso NEGATIVO: "llegar más fresco empeora el
 * pronóstico". No era un error de signo, sino un confundido — en tenis, quien
 * ha jugado mucho las últimas dos semanas es precisamente quien va GANANDO y
 * avanzando en los cuadros. La carga mide éxito reciente tanto como cansancio.
 *
 * Por eso se separa en dos features: `loadDiff` (cuántos partidos, que capta
 * sobre todo el avance en el torneo) e `intensityDiff` (cuánto costaron esos
 * partidos, que es el cansancio de verdad). Así el modelo puede separarlas en
 * vez de mezclarlas en un único coeficiente ambiguo.
 *
 * Signo: positivo = p1 ha jugado MENOS partidos.
 */
export function loadDiff(matchesP1: number, matchesP2: number, scale = 6): number {
  return (matchesP2 - matchesP1) / scale;
}

/**
 * INTENSIDAD reciente: juegos por partido en la ventana. Ganar 6-0 6-1 no cansa
 * como ganar 7-6 6-7 7-6, y esto sí es fatiga con el éxito descontado.
 * Sin partidos en la ventana se asume una intensidad típica (`neutral`), que
 * deja la diferencia en cero frente a otro jugador igual de inactivo.
 *
 * Signo: positivo = los partidos de p1 fueron MENOS desgastantes.
 */
export function intensityDiff(
  gamesP1: number, matchesP1: number,
  gamesP2: number, matchesP2: number,
  neutral = 20, scale = 10,
): number {
  const avg1 = matchesP1 > 0 ? gamesP1 / matchesP1 : neutral;
  const avg2 = matchesP2 > 0 ? gamesP2 / matchesP2 : neutral;
  return (avg2 - avg1) / scale;
}

/**
 * Descanso desde el último partido, con tope: a partir de unas semanas, más
 * descanso ya no aporta (e incluso puede oxidar). Positivo = p1 más descansado.
 */
export function restDiff(daysP1: number | null, daysP2: number | null, cap = 21): number {
  const a = Math.min(daysP1 ?? cap, cap);
  const b = Math.min(daysP2 ?? cap, cap);
  return (a - b) / cap;
}

/**
 * Forma reciente: media de la SORPRESA (resultado menos probabilidad esperada)
 * en los últimos partidos. Captura al jugador que lleva semanas rindiendo por
 * encima o por debajo de su rating, antes de que el Elo termine de absorberlo.
 */
export function formDiff(formP1: number, formP2: number): number {
  return formP1 - formP2;
}

/** Experiencia relativa. Un veterano tiene un rating más asentado que un novato. */
export function expDiff(matchesP1: number, matchesP2: number): number {
  return Math.log(1 + matchesP1) - Math.log(1 + matchesP2);
}

/**
 * Interacción entre la ventaja Elo y el formato al mejor de 5 sets.
 *
 * Un partido más largo da menos margen a la sorpresa: el favorito tiene más
 * tiempo para imponer su nivel. Es un efecto bien documentado y explica por qué
 * las probabilidades de un Grand Slam masculino no se leen igual que las de un
 * ATP250. Al ser `eloDiff` antisimétrico y `bestOf` una constante del partido,
 * el producto sigue siendo antisimétrico.
 */
export function bestOf5EloDiff(eloDiffSurface: number, bestOf: number | null): number {
  return bestOf === 5 ? eloDiffSurface : 0;
}

/**
 * Ventana deslizante de partidos recientes de un jugador, para fatiga y forma.
 * La mantiene el paso cronológico de entrenamiento; nunca contiene el partido
 * que se está evaluando.
 */
export interface RecentMatch {
  /** Fecha ISO 'YYYY-MM-DD'. */
  date: string;
  /** Juegos totales disputados (ganados + perdidos). */
  games: number;
  /** Resultado real menos probabilidad esperada antes de ese partido. */
  surprise: number;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Juegos y partidos disputados en los `windowDays` previos a `onISO`. */
export function loadInWindow(
  history: RecentMatch[],
  onISO: string,
  windowDays = 14,
): { games: number; matches: number } {
  let games = 0;
  let matches = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = daysBetween(history[i].date, onISO);
    if (d > windowDays) break; // el historial está en orden cronológico
    if (d >= 0) { games += history[i].games; matches++; }
  }
  return { games, matches };
}

/** Solo los juegos, por comodidad. */
export function gamesInWindow(history: RecentMatch[], onISO: string, windowDays = 14): number {
  return loadInWindow(history, onISO, windowDays).games;
}

/** Días desde el último partido, o null si es el debut. */
export function daysSinceLast(history: RecentMatch[], onISO: string): number | null {
  if (!history.length) return null;
  return daysBetween(history[history.length - 1].date, onISO);
}

/** Sorpresa media de los últimos `n` partidos. 0 si no hay historial. */
export function recentForm(history: RecentMatch[], n = 10): number {
  if (!history.length) return 0;
  const slice = history.slice(-n);
  return slice.reduce((a, m) => a + m.surprise, 0) / slice.length;
}
