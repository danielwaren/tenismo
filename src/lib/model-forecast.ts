import { db } from './db';
import { buildIndex, resolvePlayer } from './players';
import {
  predictMatch, estimateServeProb, simulateMatch, DEFAULT_ELO,
  type Rating, type Surface,
} from '@tti/model';

/**
 * Adaptador de "Mi pronóstico" al modelo YA EXISTENTE de Tenismo (Elo por
 * superficie + motor de juegos Markov — packages/model/src/elo.ts y
 * markov.ts). No crea un modelo nuevo: resuelve los nombres libres que se
 * escriben en el formulario a jugadores de nuestra base y llama a las mismas
 * funciones que usan train-elo.ts y el Paper Trading.
 *
 * Los mercados de SET (ganador de set, total de un set, hándicap de sets) NO
 * tienen cobertura en el modelo actual — igual que en el Paper Trading, que
 * los deja como proyección informativa sin apostar. Aquí se responde
 * explícitamente "no disponible" en vez de inventar un número.
 */

export type MarketType =
  | 'match_winner' | 'match_total_games' | 'match_handicap_games'
  | 'set_winner' | 'set_total_games' | 'set_handicap_games' | 'other';

export const MARKET_TYPE_LABEL: Record<MarketType, string> = {
  match_winner: 'Ganador del partido',
  match_total_games: 'Total de juegos del partido',
  match_handicap_games: 'Hándicap de juegos del partido',
  set_winner: 'Ganador de set',
  set_total_games: 'Total de juegos de un set',
  set_handicap_games: 'Hándicap de juegos de un set',
  other: 'Otro',
};

/** Mercados que el modelo actual sabe predecir. El resto: "no disponible". */
const SUPPORTED: ReadonlySet<MarketType> = new Set(['match_winner', 'match_total_games', 'match_handicap_games']);

export interface ForecastRequest {
  tour: 'ATP' | 'WTA' | 'Challenger' | 'ITF' | 'Other';
  playerOne: string;
  playerTwo: string;
  surface?: Surface | null;
  marketType: MarketType;
  /** Línea del mercado (total u hándicap). Requerida para esos dos tipos. */
  line?: number | null;
  /** A qué lado se apuesta: 'p1'/'p2' (hándicap) u 'over'/'under' (total). */
  side?: 'p1' | 'p2' | 'over' | 'under' | null;
  bestOf?: number | null;
}

export interface ModelForecast {
  available: boolean;
  /** Por qué no está disponible, cuando available=false. */
  unavailableReason?: string;
  /** Probabilidad de que gane/​se cumpla la selección registrada. */
  probability?: number;
  fairOdds?: number;
  suggestedSelection?: string;
  confidence?: number;
  /** Variables principales que usó el modelo, en palabras. */
  reasons?: string[];
  modelVersion: string;
}

async function resolveTwoPlayers(
  tour: string,
  playerOne: string,
  playerTwo: string,
): Promise<{ p1: number; p2: number } | null> {
  if (tour !== 'ATP' && tour !== 'WTA') return null; // Challenger/ITF: fuera del alcance del Elo actual.
  const c = db();
  const tourId = Number((await c.execute({ sql: 'select id from tours where code = ?', args: [tour] })).rows[0]?.id);
  if (!tourId) return null;

  const rows = (
    await c.execute({ sql: 'select id, slug from players where tour_id = ?', args: [tourId] })
  ).rows.map((r) => ({ id: Number(r.id), slug: String(r.slug) }));
  const index = buildIndex(rows);
  const aliases = new Map<string, number>(
    (
      await c.execute({
        sql: `select a.slug, a.player_id from player_aliases a join players p on p.id = a.player_id where p.tour_id = ?`,
        args: [tourId],
      })
    ).rows.map((r) => [String(r.slug), Number(r.player_id)]),
  );

  const r1 = resolvePlayer(playerOne, index, aliases);
  const r2 = resolvePlayer(playerTwo, index, aliases);
  if (!r1.ok || !r2.ok || r1.playerId === r2.playerId) return null;
  return { p1: r1.playerId, p2: r2.playerId };
}

async function getRating(playerId: number, surface: string | null): Promise<{ all: Rating; surf: Rating }> {
  const c = db();
  const rows = (
    await c.execute({
      sql: `select surface, elo, matches from player_ratings where player_id = ? and surface in ('all', ?)`,
      args: [playerId, surface ?? 'all'],
    })
  ).rows;
  const all = rows.find((r) => r.surface === 'all');
  const surf = surface ? rows.find((r) => r.surface === surface) : undefined;
  const allRating: Rating = all ? { elo: Number(all.elo), matches: Number(all.matches) } : { elo: DEFAULT_ELO.baseElo, matches: 0 };
  const surfRating: Rating = surf ? { elo: Number(surf.elo), matches: Number(surf.matches) } : { elo: allRating.elo, matches: 0 };
  return { all: allRating, surf: surfRating };
}

async function getServeProfile(playerId: number): Promise<{ won: number; points: number; retWon: number; retPoints: number }> {
  const c = db();
  const row = (
    await c.execute({
      sql: 'select serve_won, serve_points, return_won, return_points from player_serve_stats where player_id = ?',
      args: [playerId],
    })
  ).rows[0];
  return {
    won: Number(row?.serve_won ?? 0), points: Number(row?.serve_points ?? 0),
    retWon: Number(row?.return_won ?? 0), retPoints: Number(row?.return_points ?? 0),
  };
}

async function getTourServeRate(): Promise<number> {
  const c = db();
  const row = (await c.execute('select serve_won, serve_points from tour_serve_stats where id = 1')).rows[0];
  const won = Number(row?.serve_won ?? 0);
  const pts = Number(row?.serve_points ?? 0);
  return pts > 0 ? won / pts : 0.62;
}

export async function getModelForecast(req: ForecastRequest): Promise<ModelForecast> {
  const modelVersion = 'tennis-elo-surface-1.0.0'; // línea base, igual que en el resto de la app.

  if (!SUPPORTED.has(req.marketType)) {
    return {
      available: false,
      unavailableReason: `El modelo de Tenismo no cubre "${req.marketType === 'other' ? 'este mercado' : 'mercados de set'}" todavía — solo predice ganador del partido y juegos totales/hándicap del partido completo.`,
      modelVersion,
    };
  }

  const players = await resolveTwoPlayers(req.tour, req.playerOne, req.playerTwo);
  if (!players) {
    return {
      available: false,
      unavailableReason:
        req.tour !== 'ATP' && req.tour !== 'WTA'
          ? 'El modelo de Tenismo solo cubre circuito ATP/WTA — no tiene datos de Challenger/ITF.'
          : 'No se pudo identificar a uno de los dos jugadores en la base de Tenismo (nombre no reconocido).',
      modelVersion,
    };
  }

  const surface = (req.surface as string | null) ?? null;
  const [a, b] = await Promise.all([getRating(players.p1, surface), getRating(players.p2, surface)]);

  if (req.marketType === 'match_winner') {
    const pred = predictMatch({
      surface: (surface ?? 'hard') as Surface,
      p1: { overall: a.all, surface: a.surf, name: req.playerOne },
      p2: { overall: b.all, surface: b.surf, name: req.playerTwo },
    });
    return {
      available: true,
      probability: pred.probP1,
      fairOdds: pred.probP1 > 0 ? 1 / pred.probP1 : undefined,
      suggestedSelection: pred.probP1 >= 0.5 ? req.playerOne : req.playerTwo,
      confidence: pred.confidence,
      reasons: pred.reasons,
      modelVersion,
    };
  }

  // Juegos totales / hándicap: motor Markov, igual que el Paper Trading.
  if (req.line === null || req.line === undefined) {
    return { available: false, unavailableReason: 'Falta la línea del mercado para simular juegos.', modelVersion };
  }
  const [svA, svB, tourRate] = await Promise.all([
    getServeProfile(players.p1), getServeProfile(players.p2), getTourServeRate(),
  ]);
  const pa = estimateServeProb({ won: svA.won, points: svA.points }, { won: svB.retWon, points: svB.retPoints }, { tourServeRate: tourRate });
  const pb = estimateServeProb({ won: svB.won, points: svB.points }, { won: svA.retWon, points: svA.retPoints }, { tourServeRate: tourRate });
  const bestOf = req.bestOf ?? 3;
  const sim = simulateMatch(pa, pb, bestOf);

  if (req.marketType === 'match_total_games') {
    const side = req.side === 'under' ? 'under' : 'over';
    const pOver = sim.probOver(req.line);
    const probability = side === 'over' ? pOver : 1 - pOver;
    return {
      available: true,
      probability,
      fairOdds: probability > 0 ? 1 / probability : undefined,
      suggestedSelection: `${side === 'over' ? 'Más' : 'Menos'} de ${req.line} juegos`,
      confidence: 0.5,
      reasons: [
        `Media simulada: ${sim.meanGames.toFixed(1)} juegos (± ${sim.sdGames.toFixed(1)}).`,
        `Probabilidad de saque estimada: ${req.playerOne} ${(pa * 100).toFixed(0)}% · ${req.playerTwo} ${(pb * 100).toFixed(0)}%.`,
      ],
      modelVersion,
    };
  }

  // match_handicap_games
  const side = req.side === 'p2' ? 'p2' : 'p1';
  const pP1CoverPositive = sim.probMarginOver(-req.line); // margen de p1 (juegos p1 - juegos p2) > -línea
  const probability = side === 'p1' ? pP1CoverPositive : 1 - pP1CoverPositive;
  return {
    available: true,
    probability,
    fairOdds: probability > 0 ? 1 / probability : undefined,
    suggestedSelection: `${side === 'p1' ? req.playerOne : req.playerTwo} ${req.line > 0 ? '+' : ''}${req.line}`,
    confidence: 0.5,
    reasons: [
      `Media simulada: ${sim.meanGames.toFixed(1)} juegos totales, victoria de ${req.playerOne} en ${(sim.aWinRate * 100).toFixed(0)}% de las simulaciones.`,
    ],
    modelVersion,
  };
}
