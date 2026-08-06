/**
 * Boundary between product use-cases and tennis data sources.
 *
 * Implementations must report unsupported capabilities and missing fields;
 * consumers must never infer or fabricate a value that a provider did not
 * return explicitly.
 */
export type PlayerId = string | number;
export type MatchId = string | number;
export type TournamentId = string | number;
export type Surface = 'Hard' | 'Clay' | 'Grass' | 'Carpet' | 'Unknown';

export interface DateRange {
  from?: string;
  to?: string;
}

export type ProviderCapability =
  | 'player-profile'
  | 'rankings'
  | 'elo'
  | 'surface-elo'
  | 'match-history'
  | 'player-splits'
  | 'head-to-head'
  | 'tournament'
  | 'schedule'
  | 'live-match';

export interface ProviderCapabilities {
  provider: string;
  supported: Readonly<Record<ProviderCapability, boolean>>;
  notes?: readonly string[];
}

export type Freshness = 'live' | 'fresh' | 'stale' | 'historical' | 'unknown';
export type DataQuality = 'confirmed' | 'estimated' | 'partial' | 'unknown';

export interface DataResult<T> {
  data: T;
  source: string;
  capturedAt: string;
  observedAt?: string;
  freshness: Freshness;
  quality: DataQuality;
  licenseRef?: string;
  warnings: readonly string[];
  missingFields: readonly string[];
}

export interface PlayerProfile {
  id: PlayerId;
  name: string;
  tour?: 'ATP' | 'WTA' | 'Challenger' | 'ITF' | 'Other';
  country?: string;
  birthDate?: string;
  hand?: 'right' | 'left' | 'unknown';
  heightCm?: number;
  active?: boolean;
}

export interface RankingPoint { date: string; rank: number; points?: number }
export interface EloRating { rating: number; matches: number; at?: string }
export interface TennisMatch { id: MatchId; playedOn: string; status: string; source: string }
export interface PlayerSplits { sampleSize: number; values: Readonly<Record<string, number | null>> }
export interface HeadToHead { playerA: PlayerId; playerB: PlayerId; winsA: number; winsB: number; matches: TennisMatch[] }
export interface Tournament { id: TournamentId; name: string; surface?: Surface; startsOn?: string; endsOn?: string }
export interface LiveMatch extends TennisMatch { updatedAt: string; serverPlayerId?: PlayerId }
export interface MatchHistoryQuery extends DateRange { surface?: Surface; limit?: number }
export interface SplitQuery extends DateRange { surface?: Surface }
export interface ScheduleQuery extends DateRange { tour?: string; tournamentId?: TournamentId }

export interface TennisDataProvider {
  capabilities(): Promise<ProviderCapabilities>;
  getPlayerProfile(id: PlayerId): Promise<DataResult<PlayerProfile | null>>;
  getPlayerRankings(id: PlayerId, range?: DateRange): Promise<DataResult<RankingPoint[]>>;
  getPlayerElo(id: PlayerId, at?: string): Promise<DataResult<EloRating | null>>;
  getSurfaceElo(id: PlayerId, surface: Surface, at?: string): Promise<DataResult<EloRating | null>>;
  getMatchHistory(id: PlayerId, query?: MatchHistoryQuery): Promise<DataResult<TennisMatch[]>>;
  getPlayerSplits(id: PlayerId, query?: SplitQuery): Promise<DataResult<PlayerSplits | null>>;
  getHeadToHead(a: PlayerId, b: PlayerId): Promise<DataResult<HeadToHead>>;
  getTournament(id: TournamentId): Promise<DataResult<Tournament | null>>;
  getSchedule(query: ScheduleQuery): Promise<DataResult<TennisMatch[]>>;
  getLiveMatch(id: MatchId): Promise<DataResult<LiveMatch | null>>;
}
