import type { APIRoute } from 'astro';
import { isPremiumUser, setPremium } from '../../../../lib/profiles';
import { verifyBearerToken } from '../../../../lib/mobile-auth';
import { jsonCors, corsPreflight } from '../../../../lib/api-cors';

export const prerender = false;

/**
 * Sin equivalente en la web — nueva para "Mi banca". Sincroniza el estado
 * de Premium del stub local (`tenismo-app/src/lib/premium.tsx`) con un
 * lugar server-side, para que el límite de bancas (1 gratis / 5 Premium) no
 * dependa de confiar ciegamente en el cliente. SIGUE siendo un stub: no hay
 * verificación de pago acá — el día que se conecte RevenueCat de verdad,
 * este POST se reemplaza por el webhook de RevenueCat, no por el cliente.
 */
export const GET: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);
  return jsonCors({ isPremium: await isPremiumUser(userId) });
};

export const POST: APIRoute = async ({ request }) => {
  const userId = await verifyBearerToken(request);
  if (!userId) return jsonCors({ error: 'Sesión inválida o ausente.' }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Cuerpo vacío = "marcar premium" (uso más común desde purchasePremium()).
  }
  const isPremium = body.isPremium === undefined ? true : Boolean(body.isPremium);

  await setPremium(userId, isPremium);
  return jsonCors({ isPremium });
};

export const OPTIONS: APIRoute = async () => corsPreflight();
