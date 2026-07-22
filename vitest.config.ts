import { defineConfig } from 'vitest/config';

/**
 * Tests de los scripts de ingesta (el paquete @tti/model tiene los suyos).
 * Se prueba aquí la lógica PURA: parseo de la respuesta de The Odds API,
 * resolución de nombres y el mapa de superficies — que es donde un error se
 * propagaría a la base sin hacer ruido.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@tti/model': new URL('./packages/model/src/index.ts', import.meta.url).pathname,
    },
  },
});
