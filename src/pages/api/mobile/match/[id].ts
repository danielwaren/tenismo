import type { APIRoute } from 'astro';
import { getMatchDetail } from '../../../../lib/queries';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/**
 * Ficha de partido para la app móvil — el MISMO `getMatchDetail` que arma la
 * página web (waterfall del pronóstico, confianza, distribución de juegos,
 * proyección de aces, mercado con fair odds/edge/EV, todo). Nada se recalcula
 * aparte para móvil: la app renderiza este JSON con componentes nativos, pero
 * el número que muestra es exactamente el mismo que el de la web.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonCors({ error: 'id inválido' }, 400);

  const match = await getMatchDetail(id);
  if (!match) return jsonCors({ error: 'Partido no encontrado' }, 404);

  return jsonCors({ match });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
