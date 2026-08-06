import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';

export const prerender = false;

/**
 * Sirve la foto de un jugador.
 *
 * POR QUÉ UN PROXY Y NO LA URL DIRECTA. Tennis Abstract es una web gratuita;
 * enlazar sus imágenes desde cada visita le carga el ancho de banda a ellos y
 * nos deja a merced de que activen protección anti-hotlink. Aquí se pide una
 * vez y el CDN la guarda una semana, así que la fuente ve del orden de una
 * petición por jugador y semana.
 *
 * La atribución NO va aquí (una imagen no puede llevar crédito visible): la
 * pinta PlayerAvatar junto a la foto, con photo_credit / photo_credit_url.
 */

/** Solo se permite la fuente de la que sabemos la licencia. */
const HOST_PERMITIDO = 'www.tennisabstract.com';

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return new Response('id inválido', { status: 400 });

  const row = (
    await db().execute({ sql: 'select photo_url from players where id = ?', args: [id] })
  ).rows[0];
  const src = row?.photo_url ? String(row.photo_url) : null;
  if (!src) return new Response('sin foto', { status: 404 });

  // La URL sale de nuestra base, pero se comprueba igual: si algún día una
  // ingesta escribiera ahí otra cosa, esto no se convierte en un proxy abierto
  // con el que sondear la red interna.
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return new Response('url inválida', { status: 502 });
  }
  if (url.protocol !== 'https:' || url.hostname !== HOST_PERMITIDO) {
    return new Response('origen no permitido', { status: 502 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { Accept: 'image/jpeg,image/*' } });
  } catch {
    return new Response('no se pudo obtener la foto', { status: 502 });
  }
  if (!upstream.ok) return new Response('sin foto', { status: 404 });

  const tipo = upstream.headers.get('content-type') ?? '';
  if (!tipo.startsWith('image/')) return new Response('no es una imagen', { status: 502 });

  return new Response(upstream.body, {
    headers: {
      'content-type': tipo,
      // Una semana en el CDN, y hasta un día servido en caliente mientras se
      // revalida: las fotos de jugador no cambian casi nunca.
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
    },
  });
};
