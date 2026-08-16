import type { APIRoute } from 'astro';
import {
  createBet, listBets, getBankrollOwnerId, BetValidationError,
  type ListBetsFilters,
} from '../../../../lib/bets';
import { impliedProbability, edgeProbability, expectedValue, fairOdds } from '@tti/model';
import { getModelForecast, type MarketType } from '../../../../lib/model-forecast';
import type { BetStatus } from '@tti/model';
import { verifyBearerToken } from '../../../../lib/mobile-auth';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/**
 * Versión móvil de `api/bets/index.ts` — MISMA validación y el MISMO
 * recálculo server-side del pronóstico del modelo (nunca se confía en el
 * `modelProbability` que mande el cliente; `aiProbability` sí se toma tal
 * cual, igual que en la web — es la única excepción deliberada). Lo único
 * que se agrega es la verificación de sesión + de dueño de la banca.
 */

export const GET: APIRoute = async ({ url, request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  const bankrollId = Number(url.searchParams.get('bankrollId'));
  if (!Number.isFinite(bankrollId)) return jsonCors({ error: 'bankrollId requerido.' }, 400);
  const owner = await getBankrollOwnerId(bankrollId);
  if (owner === null) return jsonCors({ error: 'Banca no encontrada.' }, 404);
  if (owner !== userId) return jsonCors({ error: 'Esta banca no te pertenece.' }, 403);

  const filters: ListBetsFilters = { bankrollId };
  const status = url.searchParams.get('status');
  if (status) filters.status = status as BetStatus | 'ALL';
  const tour = url.searchParams.get('tour');
  if (tour) filters.tour = tour;
  const tournament = url.searchParams.get('tournament');
  if (tournament) filters.tournament = tournament;
  const market = url.searchParams.get('market');
  if (market) filters.market = market;
  const bookmaker = url.searchParams.get('bookmaker');
  if (bookmaker) filters.bookmaker = bookmaker;
  const live = url.searchParams.get('isLive');
  if (live === 'true' || live === 'false') filters.isLive = live === 'true';
  const from = url.searchParams.get('from');
  if (from) filters.from = from;
  const to = url.searchParams.get('to');
  if (to) filters.to = to;

  try {
    return jsonCors({ bets: await listBets(filters) });
  } catch (e) {
    return jsonCors({ error: `No se pudieron listar las apuestas: ${(e as Error).message}` }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const bankrollId = Number(body.bankrollId);
  if (!Number.isFinite(bankrollId)) return jsonCors({ error: 'bankrollId requerido.' }, 400);
  const owner = await getBankrollOwnerId(bankrollId);
  if (owner === null) return jsonCors({ error: 'Banca no encontrada.' }, 404);
  if (owner !== userId) return jsonCors({ error: 'Esta banca no te pertenece.' }, 403);

  const str = (k: string): string => String(body[k] ?? '').trim();
  const numOrNull = (k: string): number | null => {
    const v = body[k];
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const oddsDecimal = Number(body.oddsDecimal);
  const stake = Number(body.stake);

  if (!str('selection')) return jsonCors({ error: 'Falta la selección.' }, 400);
  if (!str('market')) return jsonCors({ error: 'Falta el mercado.' }, 400);
  if (!str('scope')) return jsonCors({ error: 'Falta el alcance del mercado.' }, 400);
  if (!(oddsDecimal > 1)) return jsonCors({ error: 'La cuota decimal debe ser mayor que 1.' }, 400);
  if (!(stake > 0)) return jsonCors({ error: 'El stake debe ser mayor que 0.' }, 400);
  if (!str('playerOne') || !str('playerTwo')) return jsonCors({ error: 'Faltan los dos jugadores.' }, 400);

  const implied = impliedProbability(oddsDecimal);

  let modelProbability: number | null = null;
  let modelFair: number | null = null;
  try {
    const forecast = await getModelForecast({
      tour: str('tour') as 'ATP' | 'WTA' | 'Challenger' | 'ITF' | 'Other',
      playerOne: str('playerOne'),
      playerTwo: str('playerTwo'),
      surface: (str('surface') || null) as never,
      marketType: (str('marketType') || 'other') as MarketType,
      line: numOrNull('line'),
      side: (body.side as 'p1' | 'p2' | 'over' | 'under' | null) ?? null,
      bestOf: numOrNull('bestOf'),
    });
    if (forecast.available && forecast.probability !== undefined) {
      modelProbability = forecast.probability;
      modelFair = fairOdds(forecast.probability);
    }
  } catch {
    modelProbability = null;
  }

  try {
    const id = await createBet({
      bankrollId,
      tournament: str('tournament') || 'Sin torneo',
      tour: str('tour') || 'ATP',
      surface: str('surface') || null,
      playerOne: str('playerOne'),
      playerTwo: str('playerTwo'),
      eventName: str('eventName') || null,
      market: str('market'),
      selection: str('selection'),
      line: numOrNull('line'),
      scope: str('scope'),
      oddsDecimal,
      stake,
      bookmaker: str('bookmaker') || null,
      isLive: body.isLive === true || body.isLive === 'true',
      liveScoreAtEntry: str('liveScoreAtEntry') || null,
      serverAtEntry: str('serverAtEntry') || null,
      modelProbability,
      modelFairOdds: modelFair,
      aiProbability: numOrNull('aiProbability'),
      aiFairOdds: numOrNull('aiProbability') !== null ? fairOdds(numOrNull('aiProbability')!) : null,
      impliedProbability: implied,
      edge: modelProbability !== null ? edgeProbability(modelProbability, oddsDecimal) : null,
      expectedValue: modelProbability !== null ? expectedValue(modelProbability, oddsDecimal) : null,
      notes: str('notes') || null,
    });
    return jsonCors({ id }, 201);
  } catch (e) {
    if (e instanceof BetValidationError) return jsonCors({ error: e.message }, 400);
    return jsonCors({ error: `No se pudo registrar la apuesta: ${(e as Error).message}` }, 500);
  }
};

export const OPTIONS: APIRoute = async () => corsPreflight();
