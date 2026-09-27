import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Prototype landing pages. Kept out of the production build (vite.config.js)
// so nothing here ships to GitHub Pages until one is picked.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  base: './',
  build: {
    outDir: 'dist-prototypes',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'prototypes/index.html'),
        branches: resolve(import.meta.dirname, 'prototypes/branches.html'),
        workbench: resolve(import.meta.dirname, 'prototypes/workbench.html'),
        grove: resolve(import.meta.dirname, 'prototypes/grove.html'),
      },
    },
  },
});
