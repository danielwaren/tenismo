/**
 * MOTOR PUNTO A PUNTO — cadena de Markov: punto → juego → tie-break → set → partido.
 *
 * Ver docs/09-diseno-pick1.md §2.2-2.5 para la derivación completa. Aquí solo
 * las fórmulas y las invariantes que las prueban.
 *
 * ANTISIMETRÍA, verificada y no asumida. `features.ts` exige que toda feature
 * sea antisimétrica (intercambiar p1/p2 debe dar 1-p). La intuición inicial al
 * escribir esto era que "quién saca primero en el set" rompería la simetría
 * (es una ventaja estructural real en tenis) y que haría falta promediar sobre
 * las dos asignaciones — pero al comprobarlo numéricamente (cuatro parejas de
 * (pa,pb), incluidos casos extremos) `setWinProb(pa,pb) + setWinProb(pb,pa)`
 * da 1 exacto hasta el error de máquina, sin promediar nada. Bajo el modelo
 * idealizado de puntos i.i.d., a quién le toca sacar primero NO cambia la
 * probabilidad de ganar el set — la ventaja real de servicio en tenis viene de
 * otros factores (presión, momentum) que este modelo no captura. El test de
 * este fichero deja la comprobación por escrito, no solo el comentario.
 */

// ── Punto → juego ────────────────────────────────────────────────────────────

/**
 * Probabilidad de ganar un juego al saque (Barnett-Clarke, forma cerrada).
 * p = probabilidad de ganar un punto sacando.
 *
 * Deducción: los cuatro caminos para ganar un juego son 4-0, 4-1, 4-2 (sin pasar
 * por deuce) y deuce-y-luego-ganar. Los tres primeros son binomiales directas;
 * el cuarto usa que P(deuce) = C(6,3)p³q³ y que, una vez en deuce, ganar es una
 * serie geométrica que se resuelve en D(p) = p²/(p²+q²).
 */
export function gameProb(p: number): number {
  const q = 1 - p;
  const p2 = p * p;
  const q2 = q * q;
  const p3 = p2 * p;
  const p4 = p3 * p;
  const q3 = q2 * q;

  const sinDeuce = p4 * (1 + 4 * q + 10 * q2);
  const probDeuce = 20 * p3 * q3;
  const ganaDesdeDeuce = p2 / (p2 + q2);

  return sinDeuce + probDeuce * ganaDesdeDeuce;
}

// ── Tie-break ────────────────────────────────────────────────────────────────

/**
 * ¿A quién le toca sacar el punto número `pointsPlayed + 1` del tie-break?
 * Patrón 1-2-2-2...: A saca el punto 1; a partir de ahí se alternan bloques de
 * 2 puntos, empezando por B.
 */
function tiebreakServerIsA(pointsPlayed: number): boolean {
  const k = pointsPlayed + 1;
  if (k === 1) return true;
  const block = Math.ceil((k - 1) / 2);
  return block % 2 === 0; // bloque impar = B, bloque par = A
}

/**
 * Probabilidad de que A gane el tie-break (a 7, con 2 de ventaja), empezando A
 * al saque. `pa` = prob. de A de ganar un punto sacando; `pb` = la de B.
 *
 * Recursión memoizada sobre el marcador (i, j). Sin forma cerrada práctica
 * (el patrón de saque no es simétrico punto a punto), pero el espacio de
 * estados es pequeño: se trunca a un margen que hace que la probabilidad no
 * cubierta sea despreciable (< 1e-15 para cualquier p en [0.05, 0.95]) y no
 * afecta a ningún decimal que se vaya a mostrar.
 */
export function tiebreakProb(pa: number, pb: number): number {
  // Tope sobre el TOTAL de puntos, no sobre la diferencia. Un tie-break muy
  // reñido mantiene la diferencia pequeña (-1, 0, +1) indefinidamente mientras
  // el total sigue creciendo — así que topar por diferencia nunca se dispara y
  // la recursión no termina (probado: revienta la pila). El total sí crece 1
  // en cada llamada, así que es la cota que de verdad acota la profundidad.
  const MAX_POINTS = 200; // la probabilidad de llegar aquí es indistinguible de 0
  const memo = new Map<string, number>();

  function rec(i: number, j: number): number {
    if (i >= 7 && i - j >= 2) return 1;
    if (j >= 7 && j - i >= 2) return 0;
    if (i + j >= MAX_POINTS) return i > j ? 1 : i < j ? 0 : 0.5; // truncamiento seguro

    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    const aSaca = tiebreakServerIsA(i + j);
    const rGanaA = aSaca ? pa : 1 - pb;
    const result = rGanaA * rec(i + 1, j) + (1 - rGanaA) * rec(i, j + 1);
    memo.set(key, result);
    return result;
  }

  return rec(0, 0);
}

// ── Juegos → set ─────────────────────────────────────────────────────────────

/**
 * Probabilidad de que el jugador que saca en los juegos IMPARES (1, 3, 5...)
 * gane el set. `pOdd`/`pEven` son sus probabilidades de ganar un punto sacando.
 * Tie-break a 6-6 (sin set de ventaja).
 *
 * Antisimétrica: setWinProb(pOdd,pEven) + setWinProb(pEven,pOdd) = 1 exacto
 * (ver la nota de cabecera del fichero). Se puede usar directamente como la
 * probabilidad de set de "p1 sacando primero" sin necesitar ningún promedio.
 */
export function setWinProb(pOdd: number, pEven: number): number {
  const memo = new Map<string, number>();

  function rec(i: number, j: number): number {
    if (i >= 6 && i - j >= 2) return 1;
    if (j >= 6 && j - i >= 2) return 0;
    if (i === 6 && j === 6) return tiebreakProb(pOdd, pEven);

    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    // Juego número i+j+1 (1-indexado): impar -> lo saca "Odd".
    const oddSirve = (i + j) % 2 === 0;
    const holdOdd = gameProb(pOdd);
    const holdEven = gameProb(pEven);
    const ganaOdd = oddSirve ? holdOdd : 1 - holdEven;
    const result = ganaOdd * rec(i + 1, j) + (1 - ganaOdd) * rec(i, j + 1);
    memo.set(key, result);
    return result;
  }

  return rec(0, 0);
}

// ── Set → partido ────────────────────────────────────────────────────────────

/** Al mejor de 3: gana quien llegue a 2 sets. S = prob. de ganar un set. */
export function matchProbBestOf3(S: number): number {
  return S * S * (3 - 2 * S);
}

/** Al mejor de 5: gana quien llegue a 3 sets. */
export function matchProbBestOf5(S: number): number {
  const q = 1 - S;
  return S * S * S * (1 + 3 * q + 6 * q * q);
}

/**
 * Probabilidad de que A gane el PARTIDO, a partir de sus probabilidades de
 * punto al saque. Sets tratados como i.i.d. (misma aproximación que usa el
 * documento de diseño: el sesgo real de no serlo es pequeño). A sirve primero
 * en cada set: por la antisimetría exacta de `setWinProb`, no hace falta
 * promediar sobre quién abre el saque.
 */
export function matchWinProb(pa: number, pb: number, bestOf: number | null): number {
  const S = setWinProb(pa, pb);
  return bestOf === 5 ? matchProbBestOf5(S) : matchProbBestOf3(S);
}

// ── Feature para la regresión ────────────────────────────────────────────────

const clamp01 = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
export function logit(p: number): number {
  const c = clamp01(p);
  return Math.log(c / (1 - c));
}

/**
 * `markovLogit`: logit de la probabilidad de partido del motor punto a punto,
 * orientado a p1. Antisimétrica por construcción (matchWinProb lo es), así que
 * encaja con el resto de FEATURE_NAMES sin romper la antisimetría del modelo.
 */
export function markovLogit(pa: number, pb: number, bestOf: number | null): number {
  return logit(matchWinProb(pa, pb, bestOf));
}

// ── Estimación de p_a / p_b a partir de estadísticas de saque ────────────────

/**
 * Media ponderada entre lo observado y un prior, con encogimiento por tamaño de
 * muestra. Igual patrón que `shrink()` en aces.ts: con pocos puntos manda el
 * prior, con muchos manda lo observado.
 */
export function shrinkRate(observedRate: number, n: number, prior: number, kappa: number): number {
  if (n <= 0) return prior;
  return (n * observedRate + kappa * prior) / (n + kappa);
}

/** Puntos ganados/jugados de un jugador, ya sea sacando o restando. */
export interface PointCount {
  won: number;
  points: number;
}

export interface ServeReturnContext {
  /** Media del circuito: probabilidad de ganar un punto al saque. */
  tourServeRate: number;
  /** Fuerza del encogimiento, en puntos. docs/09-diseno-pick1.md usa κ≈400. */
  kappa?: number;
}

export const DEFAULT_SERVE_KAPPA = 400;

/**
 * Estimación Barnett-Clarke de la probabilidad de que `server` gane un punto
 * sacando contra `returner`:
 *
 *   p = f_server - g_returner + ḡ
 *
 * donde f = tasa propia al saque, g = tasa propia al resto, ḡ = 1 - f̄ (media
 * del circuito). Cada tasa se encoge hacia su propia media antes de combinar,
 * así que un jugador sin muestra (server.points=0) aporta simplemente f̄, y dos
 * jugadores sin muestra dan el mismo valor a ambos lados — lo que dejará
 * `matchWinProb` en 0.5 y `markovLogit` en 0 sin necesitar un caso especial
 * (ver el test "sin muestra en ninguno de los dos, neutral").
 */
// ── Distribución de juegos del partido (Total y Hándicap) ────────────────────

/**
 * Generador determinista (mulberry32). No es `Math.random()` a propósito: los
 * tests necesitan una simulación reproducible, y una semilla fija hace que
 * "¿cuadra con matchWinProb?" sea una comprobación estable en vez de un test
 * intermitente.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simula un set completo juego a juego, usando `gameProb`/`tiebreakProb` —ya
 * exactas— como la probabilidad de cada sorteo. No es Monte Carlo punto a
 * punto (innecesario aquí: el resultado de un juego o de un tie-break ya tiene
 * fórmula cerrada, solo hace falta decidir aleatoriamente CUÁL de los dos
 * ocurre). `oddStarts` decide si el jugador de los juegos impares es quien abre
 * el set siendo tratado como "odd" en esta llamada.
 */
interface SetResult {
  oddWins: boolean;
  /** Marcador real del set (juegos de cada lado), tiebreak incluido como 7-6. */
  gamesOdd: number;
  gamesEven: number;
}

function simulateSet(pOdd: number, pEven: number, rng: () => number): SetResult {
  let i = 0;
  let j = 0;
  const holdOdd = gameProb(pOdd);
  const holdEven = gameProb(pEven);
  for (;;) {
    if (i >= 6 && i - j >= 2) return { oddWins: true, gamesOdd: i, gamesEven: j };
    if (j >= 6 && j - i >= 2) return { oddWins: false, gamesOdd: i, gamesEven: j };
    if (i === 6 && j === 6) {
      const oddWinsTb = rng() < tiebreakProb(pOdd, pEven);
      return oddWinsTb ? { oddWins: true, gamesOdd: 7, gamesEven: 6 } : { oddWins: false, gamesOdd: 6, gamesEven: 7 };
    }
    const oddSirve = (i + j) % 2 === 0;
    const ganaOdd = rng() < (oddSirve ? holdOdd : 1 - holdEven);
    if (ganaOdd) i++; else j++;
  }
}

export interface MatchSimulation {
  /** Juegos totales del partido, uno por simulación (para percentiles / histograma). */
  totalGames: number[];
  meanGames: number;
  sdGames: number;
  /** Fracción de simulaciones ganadas por A — debe converger a matchWinProb(pa,pb,bestOf). */
  aWinRate: number;
  /** P(total de juegos > line). Empata cuenta como 0.5 (push): line entera. */
  probOver: (line: number) => number;
  /** P(margen de juegos de A sobre B > line). Positivo favorece a A. */
  probMarginOver: (line: number) => number;
}

/**
 * Distribución de juegos del partido completo por Monte Carlo, simulando set a
 * set con las probabilidades exactas de `gameProb`/`tiebreakProb`.
 *
 * Por qué Monte Carlo y no una convolución cerrada: el número de sets jugados
 * depende del resultado (un mejor-de-3 puede acabar en 2 o 3 sets), así que la
 * distribución exacta del total de juegos requiere sumar sobre todas las
 * combinaciones de resultados de set consistentes con el marcador final. Es
 * calculable, pero mucho más código que simular — y con probabilidades exactas
 * en cada sorteo, la simulación converge rápido y sin sesgo (ver el test de
 * consistencia contra `matchWinProb`).
 */
export function simulateMatch(
  pa: number,
  pb: number,
  bestOf: number | null,
  n = 8_000,
  seed = 20260801,
): MatchSimulation {
  const setsToWin = bestOf === 5 ? 3 : 2;
  const rng = mulberry32(seed);
  const totalGames: number[] = new Array(n);
  const margin: number[] = new Array(n);
  let aWins = 0;

  for (let s = 0; s < n; s++) {
    let setsA = 0;
    let setsB = 0;
    let games = 0;
    let gamesA = 0;
    let gamesB = 0;
    // Alterna quién abre el set (impar) para no sesgar la simulación hacia
    // "A siempre saca primero" — coherente con symmetricSetWinProb.
    let aIsOdd = s % 2 === 0;
    while (setsA < setsToWin && setsB < setsToWin) {
      const r = aIsOdd ? simulateSet(pa, pb, rng) : simulateSet(pb, pa, rng);
      const aWonSet = aIsOdd ? r.oddWins : !r.oddWins;
      const gA = aIsOdd ? r.gamesOdd : r.gamesEven;
      const gB = aIsOdd ? r.gamesEven : r.gamesOdd;
      games += gA + gB;
      gamesA += gA;
      gamesB += gB;
      if (aWonSet) setsA++; else setsB++;
      aIsOdd = !aIsOdd;
    }
    totalGames[s] = games;
    margin[s] = gamesA - gamesB;
    if (setsA > setsB) aWins++;
  }

  const meanGames = totalGames.reduce((a, b) => a + b, 0) / n;
  const variance = totalGames.reduce((a, b) => a + (b - meanGames) ** 2, 0) / n;

  return {
    totalGames,
    meanGames,
    sdGames: Math.sqrt(variance),
    aWinRate: aWins / n,
    probOver: (line: number) => totalGames.filter((g) => g > line).length / n,
    probMarginOver: (line: number) => margin.filter((m) => m > line).length / n,
  };
}

export function estimateServeProb(
  server: PointCount,
  returner: PointCount,
  ctx: ServeReturnContext,
): number {
  const kappa = ctx.kappa ?? DEFAULT_SERVE_KAPPA;
  const fAvg = ctx.tourServeRate;
  const gAvg = 1 - fAvg;

  const fSelf = server.points > 0 ? server.won / server.points : fAvg;
  const fShrunk = shrinkRate(fSelf, server.points, fAvg, kappa);

  const gOpp = returner.points > 0 ? returner.won / returner.points : gAvg;
  const gShrunk = shrinkRate(gOpp, returner.points, gAvg, kappa);

  const p = fShrunk - gShrunk + gAvg;
  // Cota de seguridad: con muestras pequeñas y encogimiento débil, una
  // combinación extrema podría acercarse a 0 o 1 y disparar gameProb/tiebreak
  // a valores degenerados. 0.05-0.95 es más ancho que cualquier saque real.
  return Math.min(0.95, Math.max(0.05, p));
}
