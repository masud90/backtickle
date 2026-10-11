import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Fidelity tests: they shell out to Pandoc and Quarto, so `npm test` does not run them.
// Run with `npm run test:fidelity`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['tests/fidelity/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
