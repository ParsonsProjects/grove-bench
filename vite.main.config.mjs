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
      entry: {
        index: path.resolve('src/main/index.ts'),
        // The MCP stdio bridge that agents start as their own process (see
        // src/main/adapters/mcp-bridge). electron-builder unpacks it from
        // app.asar so it can run outside the app.
        'mcp-stdio-bridge': path.resolve('src/main/adapters/mcp-bridge/main.mjs'),
        // The utility process git and gh launch from (src/main/process-host.ts).
        // Electron runs it from inside app.asar, so it isn't unpacked.
        'process-host-child': path.resolve('src/main/process-host-child.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.js`,
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
