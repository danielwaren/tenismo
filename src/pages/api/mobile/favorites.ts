import type { APIRoute } from 'astro';
import { listFavoritePlayers, addFavorite, removeFavorite } from '../../../lib/favorites';
import { verifyBearerToken } from '../../../lib/mobile-auth';
import { jsonCors, corsPreflight } from '../../../lib/api-cors';

export const prerender = false;

/**
 * Jugadores favoritos — sin equivalente en la web, es una función nueva del
 * perfil móvil (propuesta 3: favoritos EXPLÍCITOS marcados desde la ficha de
 * jugador, no inferidos del historial de apuestas). Mismo criterio de auth
 * que "Mi banca": Bearer token de Supabase, verificado acá, nunca se lee la
 * base directo desde el cliente.
 *
 * Un solo POST con `action` (en vez de un verbo DELETE real) para no tener
 * que ampliar `CORS_HEADERS` — mismo patrón que ya usa `bankroll.ts` para
 * `movement`/`reset`.
 */
export const GET: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);
  return jsonCors({ favorites: await listFavoritePlayers(userId) });
};

export const POST: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: 'Cuerpo inválido.' }, 400);
  }

  const playerId = Number(body.playerId);
  if (!Number.isFinite(playerId)) return jsonCors({ error: 'playerId inválido.' }, 400);
  const action = body.action === 'remove' ? 'remove' : 'add';

  try {
    if (action === 'remove') await removeFavorite(userId, playerId);
    else await addFavorite(userId, playerId);
  } catch (e) {
    // FK violation (playerId inexistente) u otro error de escritura — no es
    // un 401/400 de forma, así que 500 tal cual, sin ocultar la causa en logs.
    console.error('[favorites] error al guardar:', e);
    return jsonCors({ error: 'No se pudo guardar el favorito.' }, 500);
  }

  return jsonCors({ ok: true, isFavorite: action === 'add' });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
