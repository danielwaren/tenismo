/**
 * Proyección de aces por jugador y por partido.
 *
 * QUÉ ES Y QUÉ NO ES. Esto es la versión de promedios ajustados, no el modelo
 * completo del documento de diseño (§2.8 de docs/09-diseno-pick1.md). La versión
 * buena proyecta los puntos al saque desde la cadena de Markov y usa una
 * binomial negativa para la dispersión; aquí se usan juegos al saque históricos
 * y una tasa media. Sirve para dar una expectativa razonable en la ficha, NO
 * para apostar líneas de over/under: no da probabilidad, solo un valor esperado.
 *
 * EL AJUSTE POR RIVAL ES LA MITAD DEL TRABAJO. Un sacador con 0,9 aces por juego
 * no hace lo mismo contra un restador que concede muchos que contra uno que
 * concede pocos. Se corrige multiplicando por cuánto se desvía el rival de la
 * media del circuito, que es la forma estándar (Barnett-Clarke) de separar el
 * mérito propio del demérito ajeno:
 *
 *     tasa ajustada = tasa del sacador × (concesión del restador / media)
 *
 * ENCOGIMIENTO OBLIGATORIO. Con tres partidos de muestra, la tasa observada es
 * ruido. Cada tasa se acerca a la media del circuito en proporción a lo poco que
 * se ha visto: con pocos juegos manda la media, con muchos manda el jugador.
 * Sin esto, un jugador con un solo partido de 12 aces proyectaría cifras
 * absurdas.
 */

/** Perfil de un jugador en una superficie, tal como sale de `match_stats`. */
export interface ServeProfile {
  /** Juegos al saque observados. Es el tamaño de muestra que manda. */
  serveGames: number;
  /** Aces propios por juego al saque. */
  aceRate: number;
  /** Juegos al resto observados. */
  returnGames: number;
  /** Aces concedidos por juego al resto. */
  concedeRate: number;
}

export interface AceContext {
  /** Media del circuito en esa superficie: aces por juego al saque. */
  tourAceRate: number;
  /** Juegos al saque esperados por jugador en el partido. */
  expectedServeGames: number;
  /**
   * Fuerza del encogimiento, en juegos al saque. 150 juegos ≈ 15 partidos:
   * por debajo de eso la media del circuito pesa más que lo observado.
   */
  kappa?: number;
}

export const DEFAULT_KAPPA = 150;

/**
 * Mínimo de juegos al saque para enseñar una estimación. Por debajo, lo honesto
 * es no dar número: sería la media del circuito disfrazada de pronóstico.
 */
export const MIN_SERVE_GAMES = 50;

export interface AceEstimate {
  /** Aces esperados en el partido. */
  expected: number;
  /** Tasa ajustada, aces por juego al saque. */
  perGame: number;
  /** Juegos al saque observados: el tamaño de muestra que sostiene el número. */
  sample: number;
  /** false si la muestra no llega a MIN_SERVE_GAMES. */
  reliable: boolean;
}

/** Media ponderada entre lo observado y la media del circuito. */
export function shrink(rate: number, n: number, prior: number, kappa: number): number {
  if (n <= 0) return prior;
  return (n * rate + kappa * prior) / (n + kappa);
}

/**
 * Aces esperados de `server` sacando contra `returner`.
 * Devuelve null si no hay contexto utilizable (media del circuito a cero).
 */
export function estimateAces(
  server: ServeProfile,
  returner: ServeProfile,
  ctx: AceContext,
): AceEstimate | null {
  const { tourAceRate, expectedServeGames } = ctx;
  if (!(tourAceRate > 0) || !(expectedServeGames > 0)) return null;

  const kappa = ctx.kappa ?? DEFAULT_KAPPA;

  const ace = shrink(server.aceRate, server.serveGames, tourAceRate, kappa);
  const concede = shrink(returner.concedeRate, returner.returnGames, tourAceRate, kappa);

  // Cuánto se desvía el restador de la media. 1 = restador medio.
  const opponentFactor = concede / tourAceRate;

  const perGame = ace * opponentFactor;
  return {
    perGame,
    expected: perGame * expectedServeGames,
    sample: server.serveGames,
    reliable: server.serveGames >= MIN_SERVE_GAMES && returner.returnGames >= MIN_SERVE_GAMES,
  };
}

export interface MatchAceEstimate {
  p1: AceEstimate;
  p2: AceEstimate;
  /** Aces esperados del partido: la suma de los dos. */
  total: number;
  /** true solo si AMBOS lados tienen muestra suficiente. */
  reliable: boolean;
}

/** Proyección de los dos jugadores y del total del partido. */
export function estimateMatchAces(
  p1: ServeProfile,
  p2: ServeProfile,
  ctx: AceContext,
): MatchAceEstimate | null {
  const a = estimateAces(p1, p2, ctx);
  const b = estimateAces(p2, p1, ctx);
  if (!a || !b) return null;
  return { p1: a, p2: b, total: a.expected + b.expected, reliable: a.reliable && b.reliable };
}
