import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Keep the Rust compiler output visible in the terminal during `tauri dev`.
  clearScreen: false,
  // Expose VITE_* and the TAURI_ENV_* variables set by the Tauri CLI to the frontend.
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    // Tauri expects a fixed port and fails if it is taken.
    port: 1420,
    strictPort: true,
    // Rust rebuilds are handled by the Tauri CLI, not by Vite.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // The app runs in the WebKit that ships with macOS. Playwright's WebKit is Safari 26.
    target: 'safari26',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      // Two pages: the main window and the Preferences window.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        preferences: fileURLToPath(new URL('./preferences.html', import.meta.url)),
      },
    },
  },
});
