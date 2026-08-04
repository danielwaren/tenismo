import type { APIRoute } from 'astro';
import { getModelForecast, type MarketType } from '../../../lib/model-forecast';
import { getAiProvider } from '../../../lib/ai-analysis';
import { compareForecasts } from '../../../lib/forecast-compare';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Alimenta la card "Mi pronóstico": modelo de Tenismo + análisis de IA +
 * comparación contra la cuota del mercado. Se consulta desde el formulario
 * ANTES de registrar la apuesta, para poder decidir con el contraste delante.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido.' }, 400);
  }

  const str = (k: string) => String(body[k] ?? '').trim();
  const oddsDecimal = Number(body.oddsDecimal);
  if (!(oddsDecimal > 1)) return json({ error: 'Se necesita una cuota decimal mayor que 1.' }, 400);
  if (!str('playerOne') || !str('playerTwo')) return json({ error: 'Faltan los dos jugadores.' }, 400);

  const line = body.line === null || body.line === undefined || body.line === '' ? null : Number(body.line);

  const model = await getModelForecast({
    tour: (str('tour') || 'ATP') as 'ATP' | 'WTA' | 'Challenger' | 'ITF' | 'Other',
    playerOne: str('playerOne'),
    playerTwo: str('playerTwo'),
    surface: (str('surface') || null) as never,
    marketType: (str('marketType') || 'other') as MarketType,
    line,
    side: (body.side as 'p1' | 'p2' | 'over' | 'under' | null) ?? null,
    bestOf: body.bestOf ? Number(body.bestOf) : null,
  }).catch((e) => ({
    available: false as const,
    unavailableReason: `Error al consultar el modelo: ${(e as Error).message}`,
    modelVersion: 'desconocida',
  }));

  const provider = getAiProvider();
  const ai = await provider.analyze({
    tour: str('tour'),
    tournament: str('tournament'),
    playerOne: str('playerOne'),
    playerTwo: str('playerTwo'),
    market: str('market'),
    selection: str('selection'),
    line,
    oddsDecimal,
    isLive: body.isLive === true,
    liveScoreAtEntry: str('liveScoreAtEntry') || null,
    serverAtEntry: str('serverAtEntry') || null,
    modelProbability: model.available ? (model.probability ?? null) : null,
  });

  const comparison = compareForecasts({
    modelProbability: model.available ? (model.probability ?? null) : null,
    aiProbability: ai.estimatedProbability,
    oddsDecimal,
    selectionLabel: str('selection'),
  });

  return json({ model, ai, aiConfigured: provider.configured, comparison });
};
