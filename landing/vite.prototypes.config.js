// Landing page prototypes, kept out of the production build (vite.config.js).
// Pages and their code live in prototypes/. `npm run dev:prototypes` serves
// them, `npm run build:prototypes` builds them into dist-prototypes/.
//
// The prototypes draw the grove characters from the app's own sprite code
// (src/renderer/lib, imported in prototypes/shared/app-art.js), so they always
// match what the app shows. Plain relative imports rather than an alias: the
// app's dev server scans every HTML file in the repo, and an alias it doesn't
// know reads as a missing package there.

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
  server: {
    // The app-art imports reach outside landing/.
    fs: { allow: [here('..')] },
  },
  build: {
    outDir: here('./dist-prototypes'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: here('./prototypes/index.html'),
        live: here('./prototypes/live.html'),
        story: here('./prototypes/story.html'),
        loops: here('./prototypes/loops.html'),
      },
    },
  },
});
