import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// When running from a git worktree, dependencies resolve to the main
// checkout's node_modules (up the directory tree) — outside Vite's default
// fs.allow root — which breaks setup files injected by plugins (e.g.
// @testing-library/svelte's vitest.js). Explicitly allow the node_modules
// directory that actually hosts the dependencies.
const require = createRequire(import.meta.url);
// Walk up from a resolved dependency file to its hosting node_modules dir.
// (require.resolve('<pkg>/package.json') is blocked by the package's exports map.)
let depsNodeModules = path.dirname(require.resolve('@testing-library/svelte/vite'));
while (path.basename(depsNodeModules) !== 'node_modules') {
  const parent = path.dirname(depsNodeModules);
  if (parent === depsNodeModules) break; // filesystem root — give up
  depsNodeModules = parent;
}

export default defineConfig({
  plugins: [
    svelte({
      hot: false,
      compilerOptions: {
        runes: true,
      },
    }),
  ],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), depsNodeModules],
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/main/__mocks__/setup.ts'],
        },
        resolve: {
          alias: {
            electron: path.resolve(__dirname, 'src/main/__mocks__/electron.ts'),
          },
        },
      },
      {
        extends: true,
        // svelteTesting() adds the 'browser' resolve condition so .svelte
        // components mount against the client build (not the SSR build) and
        // registers automatic DOM cleanup between tests.
        plugins: [svelteTesting()],
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.ts'],
          environment: 'jsdom',
          setupFiles: ['src/renderer/__mocks__/setup.ts'],
        },
        resolve: {
          alias: {
            $lib: path.resolve(__dirname, 'src/renderer/lib'),
          },
        },
      },
    ],
  },
});
