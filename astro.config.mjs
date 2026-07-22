import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

// Despliegue: Vercel. A diferencia de sports-trader-intelligence (que lee de
// Supabase con la anon key DESDE EL CLIENTE), aquí la base es Turso y NO existe
// RLS: el token de Turso da acceso total a la BD. Por tanto el navegador NUNCA
// habla con la base — todo pasa por páginas SSR y API routes del servidor.
// De ahí `output: 'server'` en vez de salida estática.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react(), tailwind()],
  vite: {
    // Sin envPrefix PUBLIC_: no hay ninguna variable de BD que deba llegar al
    // cliente. TURSO_* solo se lee en servidor (ver src/lib/db.ts).
    envPrefix: ['PUBLIC_'],
  },
});
