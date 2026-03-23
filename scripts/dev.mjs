/**
 * Dev script: builds main + preload, starts Vite dev server for renderer,
 * then launches Electron with VITE_DEV_SERVER_URL pointing at the dev server.
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

async function main() {
  // 1. Build main and preload (they don't need HMR)
  console.log('[dev] Building main process...');
  execSync('npx vite build --config vite.main.config.mjs', { stdio: 'inherit' });

  console.log('[dev] Building preload script...');
  execSync('npx vite build --config vite.preload.config.mjs', { stdio: 'inherit' });

  // 2. Start Vite dev server for renderer (HMR enabled)
  console.log('[dev] Starting renderer dev server...');
  const server = await createServer({
    configFile: 'vite.renderer.config.mjs',
  });
  await server.listen();

  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5173;
  const devUrl = `http://localhost:${port}`;
  console.log(`[dev] Renderer dev server running at ${devUrl}`);

  // 3. Launch Electron
  console.log('[dev] Launching Electron...');
  const electron = spawn(electronPath, ['dist/main/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
    },
  });

  electron.on('close', (code) => {
    console.log(`[dev] Electron exited with code ${code}`);
    server.close();
    process.exit(code ?? 0);
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    electron.kill();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[dev] Fatal error:', err);
  process.exit(1);
});
