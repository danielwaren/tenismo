import type { APIRoute } from 'astro';
import { getLiveMatches } from '../../lib/queries';

export const prerender = false;

/**
 * Partidos en vivo, para que la tarjeta del dashboard se refresque sola sin
 * recargar la página. La consulta corre en el servidor.
 */
export const GET: APIRoute = async () => {
  const matches = await getLiveMatches();
  return new Response(JSON.stringify({ matches, at: new Date().toISOString() }), {
    headers: { 'content-type': 'application/json' },
  });
};
