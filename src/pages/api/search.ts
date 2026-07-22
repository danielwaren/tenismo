import type { APIRoute } from 'astro';
import { searchMatches } from '../../lib/queries';

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
    return new Response(JSON.stringify({ matches: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const matches = await searchMatches(q, tour, 60);
  return new Response(JSON.stringify({ matches }), {
    headers: { 'content-type': 'application/json' },
  });
};
