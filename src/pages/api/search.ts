import type { APIRoute } from 'astro';
import { searchMatches, searchPlayers, searchTournaments, getAceEstimates } from '../../lib/queries';

export const prerender = false;

/**
 * Búsqueda de partidos por jugador o torneo. La consulta corre en el servidor
 * (la base no es accesible desde el navegador, ver src/lib/db.ts) y devuelve
 * los partidos ya resueltos.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  const tourParam = url.searchParams.get('tour');
  const tour = tourParam === 'ATP' || tourParam === 'WTA' ? tourParam : 'all';

  // Sin texto y sin filtro no se devuelve nada: evita volcar toda la base.
  if (!q.trim() && tour === 'all') {
    return new Response(JSON.stringify({ players: [], tournaments: [], matches: [], aces: {} }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const [players, tournaments, matches] = await Promise.all([
    searchPlayers(q, tour, 12), searchTournaments(q, tour, 12), searchMatches(q, tour, 40),
  ]);
  // Los aces viajan aparte, indexados por id: el buscador es una isla de React
  // y no puede consultar la base (el token de Turso no sale del servidor).
  const aces = Object.fromEntries(await getAceEstimates(matches.map((m) => m.id)));
  return new Response(JSON.stringify({ players, tournaments, matches, aces }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
