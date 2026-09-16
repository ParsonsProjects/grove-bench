import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// When running the dev server from a git worktree, dependencies resolve to the
// main checkout's node_modules (up the directory tree) — outside Vite's default
// fs.allow root — so dev-served /@fs/ imports get denied. Allow the node_modules
// directory that actually hosts the dependencies (same fix as vitest.config.mts).
let depsNodeModules = path.dirname(fileURLToPath(import.meta.resolve('@sveltejs/vite-plugin-svelte')));
while (path.basename(depsNodeModules) !== 'node_modules') {
  const parent = path.dirname(depsNodeModules);
  if (parent === depsNodeModules) break; // filesystem root — give up
  depsNodeModules = parent;
}

export default defineConfig({
  root: '.',
  plugins: [svelte(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the heavy vendor libraries out of the app chunk so the
        // browser can fetch and parse them in parallel, and so an app-only
        // change doesn't invalidate the cached vendor code. (posthog-js is
        // dynamically imported from analytics.ts and gets its own chunk.)
        manualChunks(id) {
          const p = id.replace(/\\/g, '/');
          if (!p.includes('/node_modules/')) return undefined;
          if (p.includes('/node_modules/@xterm/')) return 'xterm';
          if (p.includes('/node_modules/highlight.js/')) return 'highlight';
          if (p.includes('/node_modules/marked/') || p.includes('/node_modules/dompurify/')) return 'markdown';
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), depsNodeModules],
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/renderer/lib'),
    },
  },
});
