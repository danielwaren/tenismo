/**
 * Staking y detección de ventaja para el Paper Trading.
 *
 * REGLA NO NEGOCIABLE, heredada del proyecto de fútbol: la cuota SIEMPRE viene
 * de una casa real. Nunca se deriva una cuota de la probabilidad del propio
 * modelo — hacerlo convertiría la validación en "el modelo contra sí mismo",
 * que siempre gana.
 *
 * Nada de este fichero ejecuta apuestas ni habla con ninguna casa: son
 * funciones puras que calculan cuánto se habría apostado.
 */

// El devig del mercado de dos vías vive en calibration.ts (`devigTwoWay`): es la
// misma operación que se usa para evaluar al mercado como pronosticador, así
// que no se duplica aquí.

/**
 * Ventaja del modelo sobre el mercado: probabilidad del modelo menos la
 * implícita DEVIGADA. Comparar contra la implícita cruda inflaría la ventaja
 * con el margen de la casa y haría parecer value lo que solo es overround.
 */
export function edge(modelProb: number, devigedProb: number): number {
  return modelProb - devigedProb;
}

/**
 * Fracción de Kelly completa: f* = (p·o - 1) / (o - 1).
 * Negativa o cero significa que no hay apuesta que hacer.
 */
export function kellyFraction(modelProb: number, odds: number): number {
  if (!(odds > 1)) return 0;
  const f = (modelProb * odds - 1) / (odds - 1);
  return Number.isFinite(f) ? f : 0;
}

export interface StakeRules {
  /** Divisor de Kelly: 4 = cuarto de Kelly. Nunca menor que 1. */
  kellyDivisor: number;
  /** Tope duro por apuesta, como fracción de la banca. */
  maxStakePct: number;
  /** Ventaja mínima exigida para apostar. */
  minEdge: number;
  /** Confianza mínima del pronóstico (0..1): filtra los cold start. */
  minConfidence: number;
}

export const DEFAULT_STAKE_RULES: StakeRules = {
  // Kelly completo es demasiado agresivo cuando la probabilidad es estimada y
  // no conocida: un cuarto de Kelly es el compromiso habitual.
  kellyDivisor: 4,
  maxStakePct: 0.02,
  minEdge: 0.02,
  minConfidence: 0.5,
};

export interface BetCandidate {
  modelProb: number;
  /** Cuota REAL de una casa. */
  odds: number;
  /** Implícita devigada del mercado. */
  devigedProb: number;
  confidence: number;
}

export interface BetDecision {
  place: boolean;
  reason: string;
  edge: number;
  kelly: number;
  /** Fracción de la banca a arriesgar. 0 si no se apuesta. */
  stakeFraction: number;
}

/**
 * Decide si se simula la apuesta y con qué fracción de banca, explicando
 * siempre el porqué — también cuando la respuesta es no.
 */
export function decideBet(c: BetCandidate, rules: StakeRules = DEFAULT_STAKE_RULES): BetDecision {
  const e = edge(c.modelProb, c.devigedProb);
  const k = kellyFraction(c.modelProb, c.odds);
  const no = (reason: string): BetDecision => ({ place: false, reason, edge: e, kelly: k, stakeFraction: 0 });

  if (!(c.odds > 1)) return no('cuota inválida');
  if (c.confidence < rules.minConfidence) {
    return no(`confianza ${c.confidence.toFixed(2)} < ${rules.minConfidence} (historial insuficiente)`);
  }
  if (e < rules.minEdge) return no(`ventaja ${(e * 100).toFixed(1)}% < ${(rules.minEdge * 100).toFixed(1)}%`);
  if (k <= 0) return no('Kelly no positivo');

  const stakeFraction = Math.min(k / Math.max(1, rules.kellyDivisor), rules.maxStakePct);
  return {
    place: true,
    reason: `ventaja ${(e * 100).toFixed(1)}%, Kelly/${rules.kellyDivisor} = ${(stakeFraction * 100).toFixed(2)}% de banca`,
    edge: e,
    kelly: k,
    stakeFraction,
  };
}

/**
 * Modo FAVORITO (ago 2026): tras el backtest de docs/04, exigir "ventaja" del
 * modelo sale caro — la relación es monótona, cuanta más ventaja declara el
 * modelo peor va, porque el mercado (Pinnacle/consensus devigado) está mejor
 * calibrado y la discrepancia grande casi siempre viene del peor estimador.
 *
 * Este modo no compite con el mercado, se monta encima de él: apuesta al lado
 * que el propio mercado da como más probable (`devigedProb`, no la
 * probabilidad del modelo), y solo si esa probabilidad es alta. El objetivo
 * ya no es EV positivo — con el margen de la casa puesto, el EV esperado de
 * seguir al favorito del mercado es ligeramente negativo por construcción,
 * igual que apostar a ciegas al mejor precio (ver "no es el margen de la
 * casa" en docs/04) — el objetivo es MAXIMIZAR EL ACIERTO: picks fáciles de
 * seguir y de explicar, aunque paguen poco.
 *
 * Por eso el stake es plano (fracción fija de banca) y no Kelly: Kelly
 * necesita una ventaja real que aquí no se afirma que exista.
 */
export interface FavoriteRules {
  /** Probabilidad devigada mínima del mercado para considerarlo "favorito fuerte". */
  minFavoriteProb: number;
  /** Confianza mínima del pronóstico (0..1): mismo filtro de calidad de dato que en modo valor. */
  minConfidence: number;
  /** Fracción fija de banca por apuesta (no Kelly: aquí no hay ventaja que escalar). */
  stakePct: number;
}

export const DEFAULT_FAVORITE_RULES: FavoriteRules = {
  // Devigada > 62% ~ cuota justa por debajo de 1.61: favorito claro sin ser
  // tan extremo que la cuota ya no compense el riesgo de acertar de todos modos.
  minFavoriteProb: 0.62,
  minConfidence: 0.5,
  stakePct: 0.015,
};

export interface FavoriteCandidate {
  /** Probabilidad devigada del mercado para ESTA selección (no la del modelo). */
  devigedProb: number;
  /** Cuota REAL de una casa. */
  odds: number;
  confidence: number;
}

export interface FavoriteDecision {
  place: boolean;
  reason: string;
  stakeFraction: number;
}

/**
 * Decide si se simula la apuesta en modo Favorito. A diferencia de
 * `decideBet`, la selección la hace el MERCADO (probabilidad devigada más
 * alta entre los candidatos), no el modelo — el modelo no entra en esta
 * decisión en absoluto, solo se guarda como dato informativo en `paper_trades`.
 */
export function decideFavorite(c: FavoriteCandidate, rules: FavoriteRules = DEFAULT_FAVORITE_RULES): FavoriteDecision {
  const no = (reason: string): FavoriteDecision => ({ place: false, reason, stakeFraction: 0 });

  if (!(c.odds > 1)) return no('cuota inválida');
  if (c.confidence < rules.minConfidence) {
    return no(`confianza ${c.confidence.toFixed(2)} < ${rules.minConfidence} (historial insuficiente)`);
  }
  if (c.devigedProb < rules.minFavoriteProb) {
    return no(`favorito del mercado ${(c.devigedProb * 100).toFixed(1)}% < ${(rules.minFavoriteProb * 100).toFixed(1)}% exigido`);
  }
  return {
    place: true,
    reason: `favorito del mercado al ${(c.devigedProb * 100).toFixed(1)}%, stake plano ${(rules.stakePct * 100).toFixed(2)}% de banca`,
    stakeFraction: rules.stakePct,
  };
}

/**
 * Closing Line Value: cuánto mejor era la cuota tomada frente a la de cierre.
 * Positivo = se tomó mejor precio que el mercado al final.
 *
 * En un mercado eficiente el CLV es el mejor predictor a largo plazo de si una
 * estrategia tiene ventaja real — mejor que el beneficio, que tarda muchísimo
 * más en distinguirse de la suerte.
 */
export function clv(oddsTaken: number, closingOdds: number): number | null {
  if (!(oddsTaken > 1) || !(closingOdds > 1)) return null;
  return oddsTaken / closingOdds - 1;
}

/** Beneficio de una apuesta liquidada, a stake unitario ya aplicado. */
export function settleProfit(stake: number, odds: number, won: boolean): number {
  return won ? stake * (odds - 1) : -stake;
}
