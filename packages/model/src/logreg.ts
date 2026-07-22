/**
 * Regresión logística ajustada por IRLS (Newton-Raphson) con penalización L2.
 *
 * SIN TÉRMINO INDEPENDIENTE, y es una decisión deliberada, no un olvido.
 * Todas las features son diferencias orientadas a p1, así que con intercepto
 * cero el modelo es exactamente ANTISIMÉTRICO: intercambiar a los dos jugadores
 * devuelve 1-p. Con intercepto, el mismo partido daría probabilidades distintas
 * según a quién le tocara ser p1 — incoherente.
 *
 * Además, en la Fase 1 se midió que p1 (por construcción, el jugador registrado
 * antes) gana el 54,7% de los partidos. Un intercepto capturaría ese sesgo de
 * antigüedad y lo hornearía en el modelo como si fuera señal.
 *
 * IRLS en vez de descenso de gradiente: con ~10 features la Hessiana es
 * diminuta, converge en menos de 10 iteraciones y no hay que elegir learning rate.
 */

export interface LogRegModel {
  featureNames: string[];
  weights: number[];
  /** Iteraciones consumidas y si llegó a converger. */
  iterations: number;
  converged: boolean;
}

const clamp01 = (p: number) => Math.min(1 - 1e-12, Math.max(1e-12, p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Producto escalar fila × pesos. */
export function score(x: number[], weights: number[]): number {
  let s = 0;
  for (let j = 0; j < weights.length; j++) s += x[j] * weights[j];
  return s;
}

export function predictProb(x: number[], model: LogRegModel): number {
  return clamp01(sigmoid(score(x, model.weights)));
}

/**
 * Resuelve A·x = b por eliminación gaussiana con pivoteo parcial.
 * A se modifica in situ. Devuelve null si el sistema es singular.
 */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    if (Math.abs(A[pivot][i]) < 1e-12) return null;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];

    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      if (f === 0) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

export interface FitOptions {
  /** Fuerza de la penalización L2. Sube si hay features colineales. */
  l2?: number;
  maxIterations?: number;
  tolerance?: number;
}

/**
 * Ajusta los pesos por máxima verosimilitud penalizada.
 * `X` son las filas de features, `y` la etiqueta 0/1 (1 = ganó p1).
 */
export function fitLogistic(
  X: number[][],
  y: number[],
  featureNames: string[],
  opts: FitOptions = {},
): LogRegModel {
  const l2 = opts.l2 ?? 1;
  const maxIterations = opts.maxIterations ?? 25;
  const tolerance = opts.tolerance ?? 1e-8;

  const n = X.length;
  const d = featureNames.length;
  if (!n) throw new Error('fitLogistic: sin datos de entrenamiento');

  let weights = new Array(d).fill(0);
  let iterations = 0;
  let converged = false;

  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;

    // Gradiente: Xᵀ(y - p) - λ·w    Hessiana: XᵀWX + λI, con W = p(1-p)
    const grad = new Array(d).fill(0);
    const H: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));

    for (let i = 0; i < n; i++) {
      const xi = X[i];
      const p = clamp01(sigmoid(score(xi, weights)));
      const r = y[i] - p;
      // Suelo en W: si p satura a 0 o 1 la Hessiana se degenera y Newton diverge.
      const w = Math.max(p * (1 - p), 1e-6);
      for (let j = 0; j < d; j++) {
        grad[j] += xi[j] * r;
        const xw = xi[j] * w;
        for (let k = j; k < d; k++) H[j][k] += xw * xi[k];
      }
    }
    for (let j = 0; j < d; j++) {
      grad[j] -= l2 * weights[j];
      H[j][j] += l2;
      for (let k = 0; k < j; k++) H[j][k] = H[k][j]; // simetría
    }

    const step = solve(H, grad);
    if (!step) break;

    let maxDelta = 0;
    for (let j = 0; j < d; j++) {
      weights[j] += step[j];
      maxDelta = Math.max(maxDelta, Math.abs(step[j]));
    }
    if (maxDelta < tolerance) { converged = true; break; }
  }

  return { featureNames, weights, iterations, converged };
}

/** Log-loss medio del modelo sobre un conjunto. Sirve para elegir el L2. */
export function meanLogLoss(X: number[][], y: number[], model: LogRegModel): number {
  if (!X.length) return NaN;
  let s = 0;
  for (let i = 0; i < X.length; i++) {
    const p = predictProb(X[i], model);
    s += y[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / X.length;
}
