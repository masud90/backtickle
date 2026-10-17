import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    // happy-dom names the system it runs on in its user agent (`X11; Linux x64` on a Linux
    // machine), which `src/lib/os.ts` reads. The unit tests run as on macOS everywhere; a test of
    // another system says so with `setOsForTesting`.
    environmentOptions: {
      happyDOM: {
        settings: {
          navigator: {
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM',
          },
        },
      },
    },
    include: ['tests/unit/**/*.test.ts'],
    // The export modules read the app's CSS files as text (`?raw`).
    css: { include: [/\.css\?raw$/] },
  },
});
