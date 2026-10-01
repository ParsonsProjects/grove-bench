// Landing page prototypes, kept out of the production build (vite.config.js).
// Pages and their code live in prototypes/. `npm run dev:prototypes` serves
// them, `npm run build:prototypes` builds them into dist-prototypes/.
//
// The prototypes draw the grove characters from the app's own sprite code
// (src/renderer/lib) through the `@app-art` alias, so they always match what
// the app shows.

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./prototypes'),
  publicDir: here('./public'),
  // Relative, so the build works from any folder.
  base: './',
  plugins: [svelte({ configFile: here('./svelte.config.js') })],
  resolve: {
    alias: { '@app-art': here('../src/renderer/lib') },
  },
  server: {
    // The alias reaches outside landing/.
    fs: { allow: [here('..')] },
  },
  build: {
    outDir: here('./dist-prototypes'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: here('./prototypes/index.html'),
        grovekeeper: here('./prototypes/grovekeeper.html'),
        crew: here('./prototypes/crew.html'),
        pocket: here('./prototypes/pocket.html'),
        race: here('./prototypes/race.html'),
      },
    },
  },
});
