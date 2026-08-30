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
