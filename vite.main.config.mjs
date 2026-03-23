import { defineConfig } from 'vite';
import path from 'node:path';

const projectRoot = path.resolve('.');

export default defineConfig({
  build: {
    outDir: 'dist/main',
    lib: {
      entry: path.resolve('src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Externalize all node_modules — the main process runs in Node.js
      // and can require from node_modules at runtime
      external: (id) => {
        // Always bundle local/project files
        if (id.startsWith('.') || id.startsWith(projectRoot)) return false;
        // Bundle anything that looks like a relative path
        if (path.isAbsolute(id)) return false;
        // Externalize everything else (node built-ins + node_modules)
        return true;
      },
    },
    minify: false,
    emptyOutDir: true,
  },
});
