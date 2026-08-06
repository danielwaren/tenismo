import type { APIRoute } from 'astro';
import { getLiveTournaments, getOngoingTournaments, getUpcomingTournaments } from '../../../lib/queries';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Torneos en directo y próximos, para el selector del formulario de apuestas.
 *
 * Igual que el buscador de jugadores: escribir el torneo a mano se presta a
 * erratas ("National Bank Open" contra "ATP Canadian Open" contra "Canada"), y
 * el nombre es lo que después permite reconocer la apuesta y cruzarla con el
 * partido. Aquí la lista es corta —los que se juegan ahora o empiezan ya—, así
 * que se manda entera y el filtrado se hace en el cliente, sin una petición por
 * pulsación.
 */
export const GET: APIRoute = async () => {
  // Los EN CURSO son imprescindibles aquí, no un extra: casi siempre se apuesta
  // a un torneo que ya empezó. "Próximos" son solo los que aún no arrancan.
  const [live, ongoing, upcoming] = await Promise.all([
    getLiveTournaments(),
    getOngoingTournaments(20),
    getUpcomingTournaments(20),
  ]);

  const seen = new Set<number>();
  const salida: { id: number; name: string; tour: string; surface: string | null; live: boolean }[] = [];

  // Los en directo primero: es lo que se está apostando ahora mismo.
  for (const t of [...live, ...ongoing, ...upcoming]) {
    if (seen.has(t.id)) continue; // un torneo en directo también sale en "en curso"
    seen.add(t.id);
    salida.push({
      id: t.id,
      name: t.name,
      tour: t.tour,
      surface: t.surface,
      live: t.live > 0,
    });
  }

  return json({ tournaments: salida });
};
