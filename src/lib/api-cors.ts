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
 * Solo GET/OPTIONS: estas rutas son de lectura, igual que el resto de la API
 * pública del sitio — la app no escribe nada directo a la base.
 */
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
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
