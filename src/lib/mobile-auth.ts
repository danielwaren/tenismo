import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Verifica el token de sesión que manda la app móvil en cada request
 * autenticada ("Mi banca") — SOLO identidad, nunca datos. El proyecto entero
 * sigue con la misma regla de siempre: la base nunca se lee vía el SDK de
 * Supabase, solo a través de `db.ts` (rol `postgres`, privilegiado). Este
 * archivo es la única pieza nueva que sí usa `@supabase/supabase-js` — y
 * únicamente para `auth.getUser(token)`, que no toca ninguna tabla.
 *
 * Por qué la clave publishable alcanza acá: `getUser(jwt)` valida la firma
 * del token contra el servicio de Auth de Supabase — no concede ningún
 * acceso extra por sí sola, es la MISMA clave que ya viaja dentro del
 * paquete de la app móvil (extraíble por cualquiera igual). Una service-role
 * key sería estrictamente peor acá (bypassa RLS entero) para una tarea que
 * solo necesita "¿este JWT es válido y de quién es?".
 */
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? 'https://wtgngkmcnwpotytcypkq.supabase.co';
  const key = process.env.SUPABASE_AUTH_PUBLISHABLE_KEY;
  if (!key) return null;
  client = createClient(url, key);
  return client;
}

/** Devuelve el user id del token Bearer, o null si falta/es inválido — nunca lanza. */
export async function verifyBearerToken(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) return null;

  const supabase = getClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
