import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist/preload',
    lib: {
      entry: path.resolve('src/main/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
    },
    minify: false,
    emptyOutDir: true,
  },
});
