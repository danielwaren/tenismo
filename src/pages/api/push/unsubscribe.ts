import type { APIRoute } from 'astro';
import { deleteSubscription } from '../../../lib/push';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Borra una suscripción por endpoint. Idempotente: borrar dos veces no es error. */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) return json({ error: 'Falta el endpoint.' }, 400);

  try {
    await deleteSubscription(endpoint);
  } catch (e) {
    return json({ error: `No se pudo cancelar la suscripción: ${(e as Error).message}` }, 500);
  }
  return json({ ok: true });
};
