import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  vitePlugin: {
    // Our own components are always written in Svelte 5 runes mode.
    dynamicCompileOptions({ filename }) {
      if (!filename.includes('node_modules')) {
        return { runes: true };
      }
    },
  },
};
