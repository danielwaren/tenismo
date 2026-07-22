/** Superficies con las que trabaja el modelo. 'all' = rating global. */
export type Surface = 'hard' | 'clay' | 'grass' | 'carpet';
export type RatingScope = Surface | 'all';

export const SURFACES: Surface[] = ['hard', 'clay', 'grass', 'carpet'];

/** Rating de un jugador en un ámbito concreto, con su tamaño de muestra. */
export interface Rating {
  elo: number;
  /** Partidos ya computados en este ámbito. Gobierna el K y la confianza. */
  matches: number;
}

export interface EloParams {
  /** Rating inicial de un jugador sin historial. */
  baseElo: number;
  /**
   * K dinámico al estilo FiveThirtyEight: k = kNumerator / (m + kShift)^kDecay.
   * Un novato se mueve mucho (muestra pobre); un veterano, poco.
   */
  kNumerator: number;
  kShift: number;
  kDecay: number;
  /**
   * Encogimiento del rating de superficie hacia el global: con pocos partidos
   * en esa superficie el rating específico es ruido, así que pesa poco.
   * peso_superficie = n / (n + surfaceShrinkage)
   */
  surfaceShrinkage: number;
  /**
   * Tope al peso del rating de superficie aunque el jugador tenga muchísimos
   * partidos en ella: la fuerza general siempre aporta información.
   */
  maxSurfaceWeight: number;
  /** Partidos mínimos (en el ámbito global) para no considerarse cold start. */
  minMatchesConfident: number;
}

export const DEFAULT_ELO: EloParams = {
  baseElo: 1500,
  // 250/(m+5)^0.4 es la parametrización publicada por FiveThirtyEight para su
  // Elo de tenis: K≈131 en el debut y K≈39 tras 100 partidos.
  kNumerator: 250,
  kShift: 5,
  kDecay: 0.4,
  // 20 partidos en una superficie ya dan mitad de peso al rating específico.
  surfaceShrinkage: 20,
  // FiveThirtyEight mezcla mitad y mitad superficie/global; 0.75 permite pesar
  // algo más la superficie a un especialista claro, sin descartar lo general.
  maxSurfaceWeight: 0.75,
  minMatchesConfident: 10,
};

/** Multiplicador de K por importancia del torneo. */
export const TOURNAMENT_WEIGHT: Record<string, number> = {
  'grand slam': 1.2,
  'masters 1000': 1.1,
  'atp500': 1.0,
  'atp250': 0.95,
  'wta1000': 1.1,
  'wta500': 1.0,
  'wta250': 0.95,
  'masters cup': 1.1,
  default: 1.0,
};

export interface MatchPrediction {
  /** Probabilidad de que gane p1. En tenis no hay empate: probP2 = 1 - probP1. */
  probP1: number;
  probP2: number;
  /** Rating efectivo usado (mezcla superficie+global) para cada jugador. */
  effectiveEloP1: number;
  effectiveEloP2: number;
  /** 0..1. Baja con poco historial o con superficie poco representada. */
  confidence: number;
  /** Motivos en palabras, para la ficha del partido. */
  reasons: string[];
}
