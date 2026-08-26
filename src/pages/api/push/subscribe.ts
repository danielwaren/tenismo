import type { APIRoute } from 'astro';
import { saveSubscription } from '../../../lib/push';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Guarda una suscripción de Web Push. La manda el navegador tras
 * `pushManager.subscribe()` — ver PushSubscribeButton.tsx.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }

  const endpoint = body.endpoint;
  const keys = body.keys as Record<string, unknown> | undefined;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof endpoint !== 'string' || !endpoint || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return json({ error: 'Suscripción incompleta (falta endpoint o claves).' }, 400);
  }

  try {
    await saveSubscription({ endpoint, keys: { p256dh, auth }, userAgent: request.headers.get('user-agent') });
  } catch (e) {
    return json({ error: `No se pudo guardar la suscripción: ${(e as Error).message}` }, 500);
  }
  return json({ ok: true });
};
