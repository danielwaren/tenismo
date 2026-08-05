import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Buscador de jugadores para el autocompletado del formulario de apuestas
 * (BetForm): sin esto, el input es texto libre y cualquier variación de
 * transcripción ("Alcaraz" vs "C. Alcaraz" vs "Carlos Alcaraz Garfia") rompe
 * el resolvePlayer del pronóstico del modelo, que necesita el nombre EXACTO
 * de la base para encontrar el jugador.
 *
 * Devuelve jugadores reales de `players`, con su circuito, para que el
 * usuario elija de una lista en vez de escribir el nombre a mano.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const tour = url.searchParams.get('tour');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 8) || 8, 20);

  if (q.length < 2) return json({ players: [] });

  const c = db();
  const args: unknown[] = [`%${q}%`];
  let sql = `
    select p.id, p.name, p.slug, t.code as tour
    from players p
    join tours t on t.id = p.tour_id
    where p.name ilike ?
  `;
  if (tour) {
    sql += ' and t.code = ?';
    args.push(tour);
  }
  // Los nombres más cortos que contienen la búsqueda son casi siempre el
  // mejor acierto ("Alcaraz" debe ganarle a "Alcaraz Albert, alguien más").
  sql += ' order by length(p.name) asc limit ?';
  args.push(limit);

  const res = await c.execute({ sql, args });
  return json({
    players: res.rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      slug: String(r.slug),
      tour: String(r.tour),
    })),
  });
};
