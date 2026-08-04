import type { BetRecord, BankrollSummary, DailySummary, BankrollTransactionRecord } from '../../lib/bets';
import type { ModelForecast, MarketType } from '../../lib/model-forecast';
import type { AiBetAnalysis } from '../../lib/ai-analysis';
import type { ForecastComparison } from '../../lib/forecast-compare';

export type { BetRecord, BankrollSummary, DailySummary, BankrollTransactionRecord };
export type { ModelForecast, MarketType, AiBetAnalysis, ForecastComparison };

/** Respuesta de /api/bets/forecast. */
export interface ForecastResponse {
  model: ModelForecast;
  ai: AiBetAnalysis;
  aiConfigured: boolean;
  comparison: ForecastComparison;
}

/** Mercados ofrecidos en el formulario, con el tipo que entiende el modelo. */
export const MARKETS: { value: MarketType; label: string; needsLine: boolean; sideKind: 'player' | 'overunder' | null }[] = [
  { value: 'match_winner', label: 'Ganador del partido', needsLine: false, sideKind: 'player' },
  { value: 'match_total_games', label: 'Total de juegos (partido)', needsLine: true, sideKind: 'overunder' },
  { value: 'match_handicap_games', label: 'Hándicap de juegos (partido)', needsLine: true, sideKind: 'player' },
  { value: 'set_winner', label: 'Ganador de set', needsLine: false, sideKind: 'player' },
  { value: 'set_total_games', label: 'Total de juegos (un set)', needsLine: true, sideKind: 'overunder' },
  { value: 'set_handicap_games', label: 'Hándicap de juegos (un set)', needsLine: true, sideKind: 'player' },
  { value: 'other', label: 'Otro', needsLine: false, sideKind: null },
];

export const SCOPES = [
  { value: 'match', label: 'Partido completo' },
  { value: 'set1', label: 'Set 1' },
  { value: 'set2', label: 'Set 2' },
  { value: 'set3', label: 'Set 3' },
  { value: 'set4', label: 'Set 4' },
  { value: 'set5', label: 'Set 5' },
  { value: 'other', label: 'Otro' },
];

export const TOURS = ['ATP', 'WTA', 'Challenger', 'ITF', 'Other'] as const;
