import { fairOdds, expectedValue, impliedProbability } from './betting';

/**
 * COMPARACIÓN CON EL MERCADO — capa de presentación sobre `betting.ts` y
 * `calibration.ts::devigTwoWay` (que ya existían y ya se usaban en "Modelo vs
 * mercado"). Lo que faltaba: una probabilidad de valor en pp por sí sola no
 * dice si conviene apostar — hace falta la cuota EV real, y un criterio
 * explícito y centralizado de cuándo llamar a algo "value", para no repetir
 * ese juicio disperso por la UI ni dejarlo a ojo.
 *
 * Nunca se declara VALUE sin una cuota real tomada: sin `oddsDecimal`, el tier
 * es SIN_CUOTA (fair odds sigue mostrándose — eso no depende del mercado).
 */

export type ValueTier = 'SIN_CUOTA' | 'NO_EVALUABLE' | 'SIN_VALUE' | 'VALUE_DEBIL' | 'VALUE' | 'VALUE_FUERTE';

export const VALUE_TIER_LABEL: Record<ValueTier, string> = {
  SIN_CUOTA: 'Sin cuota',
  NO_EVALUABLE: 'No evaluable',
  SIN_VALUE: 'Sin value',
  VALUE_DEBIL: 'Value débil',
  VALUE: 'Value',
  VALUE_FUERTE: 'Value fuerte',
};

export interface ValueTierThresholds {
  /** EV mínimo (fracción, 0.02 = 2%) para dejar de ser "sin value". */
  weak: number;
  /** EV mínimo para "value" (ya no débil). */
  normal: number;
  /** EV mínimo para "value fuerte". */
  strong: number;
}

/**
 * Umbrales por defecto, centralizados aquí para no quedar hardcodeados en la
 * UI. Conservadores a propósito: con el modelo actual peor calibrado que el
 * cierre de mercado (ver "Modelo vs mercado"), un EV positivo pequeño es más
 * probablemente ruido de calibración que edge real.
 */
export const DEFAULT_VALUE_TIER_THRESHOLDS: ValueTierThresholds = {
  weak: 0.02,
  normal: 0.05,
  strong: 0.1,
};

export interface MarketComparisonInput {
  /** Probabilidad del modelo Tenismo para el lado evaluado. */
  modelProb: number;
  /** Mejor cuota decimal disponible para ese lado, o null si no hay cuota utilizable. */
  oddsDecimal: number | null;
  /** Probabilidad de mercado SIN vig (devigTwoWay), si se pudo calcular con ambos lados. */
  noVigProb: number | null;
}

export interface MarketComparisonResult {
  fairOddsModel: number | null;
  impliedProbRaw: number | null;
  noVigProb: number | null;
  /** Ventaja en puntos porcentuales: modelo − referencia (sin vig si existe, si no la implícita cruda). */
  edgePp: number | null;
  ev: number | null;
  tier: ValueTier;
  tierLabel: string;
}

export function evaluateMarket(
  input: MarketComparisonInput,
  thresholds: ValueTierThresholds = DEFAULT_VALUE_TIER_THRESHOLDS,
): MarketComparisonResult {
  const fo = fairOdds(input.modelProb);
  const fairOddsModel = Number.isFinite(fo) ? fo : null;

  if (input.oddsDecimal === null || !(input.oddsDecimal > 1)) {
    return {
      fairOddsModel,
      impliedProbRaw: null,
      noVigProb: input.noVigProb,
      edgePp: null,
      ev: null,
      tier: 'SIN_CUOTA',
      tierLabel: VALUE_TIER_LABEL.SIN_CUOTA,
    };
  }

  const impliedProbRaw = impliedProbability(input.oddsDecimal);
  const ev = expectedValue(input.modelProb, input.oddsDecimal);
  if (!Number.isFinite(ev)) {
    return {
      fairOddsModel,
      impliedProbRaw: Number.isFinite(impliedProbRaw) ? impliedProbRaw : null,
      noVigProb: input.noVigProb,
      edgePp: null,
      ev: null,
      tier: 'NO_EVALUABLE',
      tierLabel: VALUE_TIER_LABEL.NO_EVALUABLE,
    };
  }

  const referenceProb = input.noVigProb ?? impliedProbRaw;
  const edgePp = (input.modelProb - referenceProb) * 100;

  let tier: ValueTier;
  if (ev < thresholds.weak) tier = 'SIN_VALUE';
  else if (ev < thresholds.normal) tier = 'VALUE_DEBIL';
  else if (ev < thresholds.strong) tier = 'VALUE';
  else tier = 'VALUE_FUERTE';

  return {
    fairOddsModel,
    impliedProbRaw,
    noVigProb: input.noVigProb,
    edgePp,
    ev,
    tier,
    tierLabel: VALUE_TIER_LABEL[tier],
  };
}
