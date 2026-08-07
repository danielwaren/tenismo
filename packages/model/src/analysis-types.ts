import type { Surface } from './types';
import type { ConfidenceResult } from './confidence';
import type { MarketComparisonResult } from './market';

/**
 * TIPOS COMPARTIDOS DE LA FICHA DE ANÁLISIS.
 *
 * Regla de todo este fichero: NUNCA INVENTAR DATOS. Cualquier estadística que
 * pueda faltar se tipa como `T | null`, nunca con un valor por defecto
 * disfrazado de dato real. `DataProvenance.isEstimated` distingue siempre lo
 * observado (Tennis Abstract, ranking oficial, cuotas reales) de lo calculado
 * por Tenismo (Elo, motor punto a punto, proyección de aces, confianza).
 */

/** De dónde sale un dato y con qué respaldo — para tooltips, no para bloquear el render. */
export interface DataProvenance {
  /** Identificador legible de la fuente. 'tenismo-estimate' cubre cualquier cálculo propio (Elo, Markov, Poisson de aces, etc). */
  source: 'tennis-abstract' | 'official-ranking' | 'odds-api' | 'tenismo-estimate' | 'tenismo-db';
  updatedAt: string | null;
  sampleSize: number | null;
  /** 'all' cuando el dato mezcla superficies (respaldo por poca muestra); string para admitir superficies tal como llegan de la base. */
  surface: string | null;
  /** Ventana temporal en palabras, p.ej. "histórico completo", "últimos 2 años". */
  period: string | null;
  isEstimated: boolean;
}

export interface PlayerMetric {
  value: number | null;
  provenance: DataProvenance;
}

/** Un factor del waterfall, ya en pp, con el nombre en español listo para mostrar. */
export interface PredictionFactor {
  name: string;
  label: string;
  logitContribution: number;
  pp: number;
  favors: 'p1' | 'p2' | 'neutral';
}

export type PredictionConfidence = ConfidenceResult;

export interface PredictionResult {
  probP1: number;
  probP2: number;
  fairOddsP1: number | null;
  fairOddsP2: number | null;
  factors: PredictionFactor[];
  confidence: PredictionConfidence;
  modelVersion: string;
}

export interface ExpectedGamesDistribution {
  bestOf: number;
  meanGames: number;
  sdGames: number;
  /** Rango principal: percentil 25-75 de la simulación. */
  rangeLow: number;
  rangeHigh: number;
  overUnder: { line: number; over: number; under: number }[];
  /** Histograma listo para graficar: juegos totales -> probabilidad. */
  histogram: { games: number; probability: number }[];
  provenance: DataProvenance;
}

export interface AcePlayerProjection {
  expected: number;
  sample: number;
  reliable: boolean;
  /** null cuando `reliable` es false: no se muestra probabilidad sin muestra suficiente. */
  atLeast3: number | null;
  atLeast5: number | null;
  atLeast7: number | null;
}

export interface ExpectedAcesDistribution {
  p1: AcePlayerProjection;
  p2: AcePlayerProjection;
  totalExpected: number;
  totalOverUnder: { line: number; over: number; under: number }[];
  reliable: boolean;
  /** Tasa histórica real (Tennis Abstract), separada de la proyección — nunca mezclada en el mismo campo. */
  historicalRateP1: PlayerMetric;
  historicalRateP2: PlayerMetric;
  provenance: DataProvenance;
}

export type MarketComparison = MarketComparisonResult;

/**
 * Contexto estructurado para un futuro botón "Consultar al agente". Se arma
 * SIEMPRE (es barato: son los datos que ya se calculan para renderizar la
 * página) pero NO dispara ninguna llamada por sí solo — ver AIAnalysisProvider.
 */
export interface MatchAnalysisContext {
  match: {
    id: number;
    tour: string;
    surface: Surface | null;
    tournament: string;
    round: string | null;
    bestOf: number | null;
  };
  players: {
    p1: { id: number; name: string };
    p2: { id: number; name: string };
  };
  prediction: PredictionResult;
  expectedGames: ExpectedGamesDistribution | null;
  expectedAces: ExpectedAcesDistribution | null;
  h2h: { p1Wins: number; p2Wins: number; meetings: number };
  market: MarketComparison | null;
}

/**
 * Interfaz desacoplada para integrar un proveedor de IA más adelante (OpenAI
 * Responses API u otro). Ningún código de la app la implementa todavía — el
 * modelo estadístico y la UI funcionan sin ella. Ver informe final: qué falta
 * para conectarla de verdad (endpoint, límite de uso, botón "Consultar al
 * agente" en la UI, caché de respuestas).
 */
export interface AIAnalysisProvider {
  analyze(context: MatchAnalysisContext): Promise<string>;
}
