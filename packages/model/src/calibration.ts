/**
 * Métricas de calibración para un pronóstico BINARIO.
 *
 * En fútbol había que promediar el Brier sobre las tres salidas del 1X2; aquí
 * basta la versión binaria clásica, que además es directamente comparable con
 * la literatura de tenis.
 */

export interface BinaryOutcome {
  /** Probabilidad que dio el modelo al evento (que ganara p1). */
  prob: number;
  /** ¿ocurrió? 1 = sí. */
  actual: 0 | 1;
}

/** Brier score: media de (p - y)². 0 = perfecto, 0.25 = tirar una moneda. */
export function brierScore(rows: BinaryOutcome[]): number {
  if (!rows.length) return NaN;
  const s = rows.reduce((acc, r) => acc + (r.prob - r.actual) ** 2, 0);
  return s / rows.length;
}

/** Log-loss. Se recorta a [eps, 1-eps] para que un 0 rotundo no dé infinito. */
export function logLoss(rows: BinaryOutcome[], eps = 1e-12): number {
  if (!rows.length) return NaN;
  const s = rows.reduce((acc, r) => {
    const p = Math.min(1 - eps, Math.max(eps, r.prob));
    return acc + (r.actual === 1 ? -Math.log(p) : -Math.log(1 - p));
  }, 0);
  return s / rows.length;
}

/**
 * Brier del pronóstico trivial (predecir siempre la tasa base). Sirve de línea
 * base honesta: un modelo que no la bate no aporta nada.
 */
export function baselineBrier(rows: BinaryOutcome[]): number {
  if (!rows.length) return NaN;
  const base = rows.reduce((a, r) => a + r.actual, 0) / rows.length;
  return rows.reduce((a, r) => a + (base - r.actual) ** 2, 0) / rows.length;
}

/**
 * Skill score frente a la tasa base: 1 = perfecto, 0 = igual que la base,
 * negativo = peor que no modelar nada.
 */
export function brierSkillScore(rows: BinaryOutcome[]): number {
  const b = brierScore(rows);
  const ref = baselineBrier(rows);
  if (!isFinite(b) || !isFinite(ref) || ref === 0) return NaN;
  return 1 - b / ref;
}

export interface ReliabilityBin {
  from: number;
  to: number;
  count: number;
  /** Probabilidad media predicha en el bin. */
  meanPredicted: number;
  /** Frecuencia observada en el bin. */
  observed: number;
}

/**
 * Diagrama de fiabilidad: agrupa por probabilidad predicha y compara con la
 * frecuencia real. Si el modelo está calibrado, ambas coinciden.
 */
export function reliabilityBins(rows: BinaryOutcome[], nBins = 10): ReliabilityBin[] {
  const bins: ReliabilityBin[] = Array.from({ length: nBins }, (_, i) => ({
    from: i / nBins,
    to: (i + 1) / nBins,
    count: 0,
    meanPredicted: 0,
    observed: 0,
  }));

  for (const r of rows) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(r.prob * nBins)));
    const b = bins[idx];
    b.count++;
    b.meanPredicted += r.prob;
    b.observed += r.actual;
  }

  for (const b of bins) {
    if (b.count > 0) {
      b.meanPredicted /= b.count;
      b.observed /= b.count;
    }
  }
  return bins;
}

/**
 * Probabilidad implícita SIN margen de la casa, para un mercado binario.
 * El overround se reparte proporcionalmente entre las dos selecciones.
 * Devuelve null si las cuotas no son utilizables.
 */
export function devigTwoWay(oddsP1: number, oddsP2: number): { p1: number; p2: number } | null {
  if (!(oddsP1 > 1) || !(oddsP2 > 1)) return null;
  const i1 = 1 / oddsP1;
  const i2 = 1 / oddsP2;
  const total = i1 + i2;
  if (!(total > 0)) return null;
  return { p1: i1 / total, p2: i2 / total };
}
