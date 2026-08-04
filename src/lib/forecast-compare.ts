import { impliedProbability, fairOdds, expectedValue } from '@tti/model';

/**
 * Comparación de las tres lecturas de la card "Mi pronóstico": modelo de
 * Tenismo, análisis de IA y lo que exige la cuota del mercado. Función pura
 * — la UI solo pinta lo que sale de aquí.
 *
 * Nunca presenta una recomendación como certeza: el consenso es una
 * descripción de cuánto se parecen las tres cifras, no un consejo.
 */

export type ConsensusState = 'AGREE' | 'PARTIAL' | 'DISAGREE' | 'INSUFFICIENT';

export const CONSENSUS_LABEL: Record<ConsensusState, string> = {
  AGREE: 'Coinciden',
  PARTIAL: 'Parcialmente de acuerdo',
  DISAGREE: 'En desacuerdo',
  INSUFFICIENT: 'Datos insuficientes',
};

export interface ForecastComparison {
  modelProbability: number | null;
  aiProbability: number | null;
  /** Diferencia absoluta entre las dos probabilidades, si existen ambas. */
  difference: number | null;
  marketOdds: number;
  impliedProbability: number;
  modelFairOdds: number | null;
  aiFairOdds: number | null;
  modelEv: number | null;
  aiEv: number | null;
  consensus: ConsensusState;
  explanation: string;
}

/** Umbrales de acuerdo, en puntos de probabilidad. */
const AGREE_MAX_DIFF = 0.05;
const PARTIAL_MAX_DIFF = 0.12;

export function compareForecasts(input: {
  modelProbability: number | null;
  aiProbability: number | null;
  oddsDecimal: number;
  selectionLabel: string;
}): ForecastComparison {
  const implied = impliedProbability(input.oddsDecimal);
  const m = input.modelProbability;
  const a = input.aiProbability;

  const difference = m !== null && a !== null ? Math.abs(m - a) : null;
  let consensus: ConsensusState;
  if (m === null && a === null) consensus = 'INSUFFICIENT';
  else if (difference === null) consensus = 'INSUFFICIENT';
  else if (difference <= AGREE_MAX_DIFF) consensus = 'AGREE';
  else if (difference <= PARTIAL_MAX_DIFF) consensus = 'PARTIAL';
  else consensus = 'DISAGREE';

  const pctStr = (x: number) => `${(x * 100).toFixed(0)}%`;
  const parts: string[] = [];
  if (m !== null) parts.push(`Tenismo estima ${pctStr(m)}`);
  parts.push(`la cuota ${input.oddsDecimal.toFixed(2)} exige ${(implied * 100).toFixed(1)}%`);
  if (a !== null) parts.push(`la IA estima ${pctStr(a)}`);

  let verdict = '';
  if (m !== null || a !== null) {
    const best = m ?? a!;
    const gap = best - implied;
    if (gap > 0.05) verdict = ' Se detecta valor.';
    else if (gap > 0.01) verdict = ' Valor moderado.';
    else if (gap > -0.01) verdict = ' Prácticamente en línea con el mercado.';
    else verdict = ' La cuota exige más de lo estimado.';
  } else {
    verdict = ' Sin estimación propia no se puede juzgar la cuota.';
  }

  return {
    modelProbability: m,
    aiProbability: a,
    difference,
    marketOdds: input.oddsDecimal,
    impliedProbability: implied,
    modelFairOdds: m !== null ? fairOdds(m) : null,
    aiFairOdds: a !== null ? fairOdds(a) : null,
    modelEv: m !== null ? expectedValue(m, input.oddsDecimal) : null,
    aiEv: a !== null ? expectedValue(a, input.oddsDecimal) : null,
    consensus,
    explanation: `${parts.join('. ')}.${verdict}`,
  };
}
