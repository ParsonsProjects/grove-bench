import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  base: '/grove-bench/',
  server: {
    // The characters come from the app's own sprite code in src/renderer/lib
    // (see src/shared/app-art.js), outside this folder.
    fs: { allow: ['..'] },
  },
});
