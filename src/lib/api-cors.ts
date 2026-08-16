/**
 * CORS para las rutas que consume la app móvil (Expo/React Native).
 *
 * En nativo (iOS/Android) CORS no aplica — lo hacen cumplir los navegadores,
 * no los clientes HTTP nativos —, pero el mismo código Expo también corre
 * como target WEB (react-native-web) para poder probarlo aquí y para una
 * futura PWA, y ESE sí es un navegador. Sin este header, `fetch` desde
 * `localhost:8081` (Expo web) a este dominio se bloquea en silencio y parece
 * "la API no responde" cuando en realidad respondió y el navegador la tiró.
 *
 * GET+POST/OPTIONS, header `authorization` incluido: desde "Mi banca"
 * (ago 2026) hay rutas móviles que sí escriben (`/api/mobile/bets/*`),
 * autenticadas con el token de sesión de Supabase de quien llama. Esto es
 * solo la lista de permitidos del preflight — declarativo, no otorga ningún
 * permiso por sí solo: cada ruta sigue validando su propio método y, las que
 * escriben, el Bearer token (ver `mobile-auth.ts`). Las rutas GET-only que ya
 * existían no se ven afectadas — nunca reciben POST ni `authorization`.
 */
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
} as const;

export function jsonCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
