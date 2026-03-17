import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    svelte({
      hot: false,
      compilerOptions: {
        runes: true,
      },
    }),
  ],
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
