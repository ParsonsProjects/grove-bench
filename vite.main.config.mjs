import { defineConfig } from 'vite';
import path from 'node:path';
import builtinModules from 'module';

const projectRoot = path.resolve('.');

// Only externalize: node builtins, electron, and native addons
const externalPatterns = [
  /^node:/,
  /^electron$/,
  /^electron-updater$/,
  /^node-pty$/,
];

const nodeBuiltins = new Set(builtinModules.builtinModules);

export default defineConfig({
  build: {
    outDir: 'dist/main',
    lib: {
      entry: path.resolve('src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: (id) => {
        // Always bundle local/project files
        if (id.startsWith('.') || id.startsWith(projectRoot)) return false;
        if (path.isAbsolute(id)) return false;
        // Externalize node builtins, electron, and native addons
        if (nodeBuiltins.has(id)) return true;
        return externalPatterns.some((pat) => pat.test(id));
      },
    },
    minify: false,
    emptyOutDir: true,
  },
  resolve: {
    // Ensure Node.js-specific exports are preferred when bundling
    conditions: ['node', 'import'],
  },
});
