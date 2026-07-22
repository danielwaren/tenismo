import { createClient, type Client } from '@libsql/client';

/**
 * Cliente libSQL — SOLO SERVIDOR.
 *
 * Turso no tiene RLS: `TURSO_AUTH_TOKEN` da acceso total de lectura y escritura.
 * Por eso este módulo no debe importarse nunca desde un componente de React que
 * se hidrate en el cliente; las páginas Astro son SSR y las islas reciben los
 * datos ya resueltos como props. (En el proyecto de fútbol el navegador sí
 * hablaba con Supabase, pero allí la anon key estaba acotada por RLS.)
 *
 * La misma librería sirve para desarrollo y producción:
 *   file:./data/tennis.db          → SQLite local, sin cuenta ni token
 *   libsql://<bd>-<org>.turso.io   → Turso, con TURSO_AUTH_TOKEN
 */

let client: Client | null = null;

export function db(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL ?? 'file:./data/tennis.db';
  const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

  if (url.startsWith('libsql://') && !authToken) {
    throw new Error(
      'TURSO_DATABASE_URL apunta a Turso pero falta TURSO_AUTH_TOKEN. ' +
        'Para trabajar sin cuenta, usa file:./data/tennis.db',
    );
  }

  client = createClient({ url, authToken });
  return client;
}

/** ¿Estamos contra el fichero local en vez de Turso? (útil para mensajes). */
export function isLocalDb(): boolean {
  return (process.env.TURSO_DATABASE_URL ?? 'file:').startsWith('file:');
}
