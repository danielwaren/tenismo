import type { APIRoute } from 'astro';
import { getLiveNow } from '../../lib/live';

export const prerender = false;

/**
 * Partidos en vivo AHORA. Consulta ESPN en el momento (con caché de 12 s), no
 * la foto que dejó el último cron: así un partido que acaba de empezar aparece
 * y uno que acaba de terminar desaparece.
 */
export const GET: APIRoute = async () => {
  const matches = await getLiveNow();
  return new Response(JSON.stringify({ matches, at: new Date().toISOString() }), {
    headers: {
      'content-type': 'application/json',
      // Sin caché intermedia: el dato es efímero por definición.
      'cache-control': 'no-store',
    },
  });
};
