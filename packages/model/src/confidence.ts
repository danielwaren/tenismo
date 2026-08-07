/**
 * CONFIANZA DEL MODELO, 0-100 — testeable, no arbitraria.
 *
 * No mide "qué tan seguro está el modelo del resultado" (eso ya lo dice la
 * propia probabilidad: 50% es la máxima incertidumbre posible). Mide "cuánta
 * información real sostiene ese número" — igual que `elo.ts::confidence()`,
 * pero ampliada con dos señales que esa función no tenía: cobertura de
 * estadísticas de saque y desacuerdo entre las dos fuentes de señal
 * independientes que ya calcula el modelo (la regresión logística por un lado,
 * el motor punto a punto `markovLogit` por otro).
 *
 * Cuatro componentes, cada uno 0-1, combinados con pesos que suman 1
 * (documentados, no ajustados a ojo por partido):
 *
 *   · historial (35%)  — min(partidos jugador 1, partidos jugador 2) frente al
 *     mismo umbral que ya usa el Elo (`minMatchesConfident`, 10 partidos).
 *   · superficie (25%) — igual pero con partidos en ESTA superficie
 *     (`surfaceShrinkage`, 20 partidos: el mismo denominador que usa
 *     `surfaceWeight` para mezclar el Elo global con el de superficie).
 *   · cobertura (15%)  — si hay muestra de saque suficiente (`MIN_SERVE_GAMES`
 *     de aces.ts) para ambos jugadores. Sin eso, "Aces esperados" ya se oculta
 *     en la UI — aquí se refleja en el score en vez de tratarse aparte.
 *   · acuerdo (25%)    — cuánto coinciden la probabilidad de la regresión y la
 *     del motor punto a punto. Dos señales independientes que dicen lo mismo
 *     son más fiables que una sola; si divergen mucho, es una señal de alerta
 *     que el modelo agregado no expone por sí solo.
 *
 * Los pesos y umbrales están centralizados aquí (no hardcodeados en la UI) para
 * que cualquier ajuste futuro quede documentado en un solo sitio.
 */

export interface ConfidenceWeights {
  history: number;
  surface: number;
  coverage: number;
  agreement: number;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  history: 0.35,
  surface: 0.25,
  coverage: 0.15,
  agreement: 0.25,
};

export interface ConfidenceParams {
  minMatchesConfident: number;
  surfaceShrinkage: number;
  /** Diferencia de probabilidad (0-1) entre las dos señales a partir de la cual el acuerdo se considera nulo. */
  maxDisagreement: number;
}

export const DEFAULT_CONFIDENCE_PARAMS: ConfidenceParams = {
  minMatchesConfident: 10,
  surfaceShrinkage: 20,
  maxDisagreement: 0.25,
};

export interface ConfidenceInputs {
  matchesP1: number;
  matchesP2: number;
  surfaceMatchesP1: number;
  surfaceMatchesP2: number;
  /** true si ambos jugadores llegan a MIN_SERVE_GAMES de muestra de saque. */
  serveStatsReliable: boolean;
  /** Probabilidad de p1 según el modelo activo (regresión logística). */
  modelProbP1: number;
  /** Probabilidad de p1 según el motor punto a punto, si se pudo calcular. */
  markovProbP1?: number | null;
}

export type ConfidenceBand = 'ALTA' | 'MEDIA' | 'BAJA';

export interface ConfidenceBreakdownItem {
  label: string;
  score: number; // 0-1
  weight: number; // 0-1
}

export interface ConfidenceResult {
  score: number; // 0-100
  band: ConfidenceBand;
  breakdown: ConfidenceBreakdownItem[];
  explanation: string;
}

function bandOf(score: number): ConfidenceBand {
  if (score >= 70) return 'ALTA';
  if (score >= 45) return 'MEDIA';
  return 'BAJA';
}

export function computeConfidence(
  input: ConfidenceInputs,
  params: ConfidenceParams = DEFAULT_CONFIDENCE_PARAMS,
  weights: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS,
): ConfidenceResult {
  const histScore = Math.min(1, Math.min(input.matchesP1, input.matchesP2) / params.minMatchesConfident);
  const surfScore = Math.min(1, Math.min(input.surfaceMatchesP1, input.surfaceMatchesP2) / params.surfaceShrinkage);
  const coverageScore = input.serveStatsReliable ? 1 : 0.4;

  let agreementScore = 0.7; // neutral: sin segunda señal no se puede medir acuerdo, no se penaliza ni premia de más.
  if (input.markovProbP1 !== undefined && input.markovProbP1 !== null && Number.isFinite(input.markovProbP1)) {
    const disagreement = Math.abs(input.modelProbP1 - input.markovProbP1);
    agreementScore = Math.max(0, 1 - disagreement / params.maxDisagreement);
  }

  const breakdown: ConfidenceBreakdownItem[] = [
    { label: 'Historial de partidos', score: histScore, weight: weights.history },
    { label: 'Muestra en esta superficie', score: surfScore, weight: weights.surface },
    { label: 'Cobertura de estadísticas de saque', score: coverageScore, weight: weights.coverage },
    { label: 'Acuerdo entre señales del modelo', score: agreementScore, weight: weights.agreement },
  ];

  const weighted = breakdown.reduce((acc, b) => acc + b.score * b.weight, 0);
  const score = Math.round(weighted * 100);
  const band = bandOf(score);

  const minMatches = Math.min(input.matchesP1, input.matchesP2);
  const minSurfaceMatches = Math.min(input.surfaceMatchesP1, input.surfaceMatchesP2);
  const explanation =
    `Basado en ${minMatches} partidos del jugador con menos historial, ` +
    `${minSurfaceMatches} en esta superficie` +
    `${input.serveStatsReliable ? '' : ', estadísticas de saque insuficientes'}` +
    `${agreementScore < 0.6 ? ', y desacuerdo notable entre las señales del modelo' : ''}.`;

  return { score, band, breakdown, explanation };
}
