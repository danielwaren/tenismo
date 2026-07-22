import { defineConfig } from 'vitest/config';

// Config propia: sin ella, vitest sube hasta la raíz del repo, coge el
// vitest.config.ts de allí (que apunta a scripts/) y no encuentra estos tests.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
