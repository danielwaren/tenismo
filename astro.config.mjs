import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';

// Despliegue: Vercel. PostgreSQL/Supabase se consulta exclusivamente desde el
// servidor con un rol de base de datos; las credenciales nunca llegan al
// navegador. De ahí `output: 'server'` en vez de salida estática.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  integrations: [react(), tailwind()],
  vite: {
    // Solo las variables explícitamente públicas pueden entrar al bundle. Las
    // SUPABASE_DB_* se leen únicamente en servidor (ver src/lib/db.ts).
    envPrefix: ['PUBLIC_'],
  },
});
