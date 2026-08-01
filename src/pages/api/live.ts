import type { APIRoute } from 'astro';
import { getLiveNow } from '../../lib/live';
import { getAceEstimates } from '../../lib/queries';

export const prerender = false;

/**
 * Partidos en vivo AHORA. Consulta ESPN en el momento (con caché de 12 s), no
 * la foto que dejó el último cron: así un partido que acaba de empezar aparece
 * y uno que acaba de terminar desaparece.
 */
export const GET: APIRoute = async () => {
  const matches = await getLiveNow();
  // Los aces viajan con el marcador: la tarjeta de en vivo se refresca sola cada
  // 20 s y, si no vinieran aquí, la proyección desaparecería en el primer tick.
  const aces = Object.fromEntries(await getAceEstimates(matches.map((m) => m.id)));
  return new Response(JSON.stringify({ matches, aces, at: new Date().toISOString() }), {
    headers: {
      'content-type': 'application/json',
      // Sin caché intermedia: el dato es efímero por definición.
      'cache-control': 'no-store',
    },
  });
};
