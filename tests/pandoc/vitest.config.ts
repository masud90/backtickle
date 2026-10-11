import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Word export tests: they run the real Pandoc, so `npm test` does not run them.
// Run with `npm run test:pandoc`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['tests/pandoc/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
