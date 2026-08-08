import type { APIRoute } from 'astro';
import { getPlayerProfile } from '../../../../lib/queries';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/** Ficha de jugador para la app móvil — mismo `getPlayerProfile` que la web. */
export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonCors({ error: 'id inválido' }, 400);

  const player = await getPlayerProfile(id);
  if (!player) return jsonCors({ error: 'Jugador no encontrado' }, 404);

  return jsonCors({ player });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
