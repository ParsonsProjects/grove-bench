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

/**
 * Content Security Policy for the app window, as a <meta> tag (the renderer
 * loads from file://, which has no response headers). The preload bridge can
 * reach the shell and PTYs, so script injection must not run: only the app's
 * own bundled scripts, no inline scripts or eval. Inline styles stay allowed
 * (Svelte, bits-ui and xterm set them). Images are local, data: or blob: only,
 * so agent markdown can't make the app request a remote image URL, a known
 * way to leak conversation data. connect-src allows the analytics host.
 */
function contentSecurityPolicy() {
  let env = {};
  return {
    name: 'grove-csp',
    configResolved(config) {
      env = config.env;
    },
    transformIndexHtml(_html, ctx) {
      const connect = ["'self'", new URL(env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').origin];
      // Vite's hot-reload websocket in dev.
      if (ctx.server) connect.push('ws://localhost:*');
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        `connect-src ${connect.join(' ')}`,
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [svelte(), tailwindcss(), contentSecurityPolicy()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    // Panels and tabs that open on demand load on first use (lazyComponent),
    // so the main chunk is the code that draws the first screen. It sits near
    // 685 kB (V8 parses it in about 20 ms); splitting it further only moves
    // that code between files, which an app loading from disk gains little
    // from. Warn if it grows past this.
    chunkSizeWarningLimit: 700,
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
