/**
 * PROBABILIDADES DE ACES — capa nueva sobre `aces.ts`.
 *
 * `estimateMatchAces` (aces.ts) da solo un VALOR ESPERADO (una media ajustada
 * por rival y encogida por tamaño de muestra). No da probabilidades — está
 * documentado explícitamente ahí ("no da probabilidad, solo un valor
 * esperado").
 *
 * ESTIMACIÓN TENISMO, no dato histórico: para responder "P(3+ aces)" o
 * "P(Over 8.5 aces)" hace falta asumir una FORMA de distribución alrededor de
 * esa media. Se usa Poisson — la aproximación estándar para conteos raros e
 * independientes por unidad de tiempo (aquí, por juego al saque), la misma
 * familia que se usa en la literatura de trading deportivo para líneas de
 * aces/tarjetas/córners. Es una asunción de modelo, declarada como tal en cada
 * campo que devuelve esta función — nunca se presenta como frecuencia
 * observada.
 *
 * Limitación conocida, no escondida: los aces reales no son estrictamente
 * Poisson (hay autocorrelación por rachas de saque, cambios de superficie
 * dentro del propio partido, etc.). Para un número de "esperados" con rango,
 * es una aproximación razonable; no se debe vender como calibración exacta de
 * apuestas de precisión sin validar contra resultados reales (pendiente,
 * ver informe final).
 */

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** P(X = k) para X ~ Poisson(lambda). */
export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0 || !Number.isInteger(k)) return 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

/** P(X >= k) para X ~ Poisson(lambda). */
export function poissonAtLeast(lambda: number, k: number): number {
  if (lambda <= 0) return k <= 0 ? 1 : 0;
  if (k <= 0) return 1;
  let cumulativeBelow = 0;
  for (let i = 0; i < k; i++) cumulativeBelow += poissonPmf(lambda, i);
  return Math.max(0, Math.min(1, 1 - cumulativeBelow));
}

/** P(X > line) para una línea tipo X.5 (over de mercado). */
export function poissonOver(lambda: number, line: number): number {
  const k = Math.floor(line) + 1; // line=2.5 -> over exige X>=3
  return poissonAtLeast(lambda, k);
}

export interface AceProbabilityBreakdown {
  atLeast3: number;
  atLeast5: number;
  atLeast7: number;
}

/** Umbrales estándar mostrados en la ficha. Centralizados para no repetir "3/5/7" en la UI. */
export const ACE_THRESHOLDS = [3, 5, 7] as const;

export function acesAtLeastBreakdown(expected: number): AceProbabilityBreakdown {
  return {
    atLeast3: poissonAtLeast(expected, 3),
    atLeast5: poissonAtLeast(expected, 5),
    atLeast7: poissonAtLeast(expected, 7),
  };
}

/** Over/under del TOTAL del partido en varias líneas, asumiendo Poisson(esperados p1 + esperados p2). */
export function totalAcesOverUnder(
  totalExpected: number,
  lines: number[],
): { line: number; over: number; under: number }[] {
  return lines.map((line) => {
    const over = poissonOver(totalExpected, line);
    return { line, over, under: 1 - over };
  });
}
