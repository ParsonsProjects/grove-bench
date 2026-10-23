/**
 * Smoke test for the packaged app: loads node-pty with the packaged Electron
 * runtime and runs a command in a real terminal. Catches a missing or
 * incompatible native module before an installer is published.
 *
 * Usage (after `npm run dist`): node scripts/smoke-pty.mjs
 *
 * Re-runs itself inside "out/win-unpacked/Grove Bench.exe" with
 * ELECTRON_RUN_AS_NODE=1, so the check uses Electron's Node, not the host's.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 30_000;
// Typed with carets so only cmd's output (not the echoed input) contains it.
const COMMAND = 'echo grove^-pty^-ok\r';
const MARKER = 'grove-pty-ok';

function runInPackagedApp() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const appDir = path.join(root, 'out', 'win-unpacked');
  const exe = path.join(appDir, 'Grove Bench.exe');
  const ptyDir = path.join(appDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');

  const result = spawnSync(exe, [fileURLToPath(import.meta.url), ptyDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: TIMEOUT_MS + 10_000,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function checkPty(ptyDir) {
  console.log(`Electron ${process.versions.electron}, node-pty from ${ptyDir}`);
  const pty = createRequire(import.meta.url)(ptyDir);
  const term = pty.spawn('cmd.exe', [], { cols: 80, rows: 24, cwd: process.cwd(), env: process.env });

  let output = '';
  let sent = false;
  let done = false;
  const finish = (code, message) => {
    // kill() can fire onExit synchronously; only the first result counts.
    if (done) return;
    done = true;
    console.log(message);
    try { term.kill(); } catch { /* exiting anyway */ }
    process.exit(code);
  };

  term.onData((data) => {
    output += data;
    if (!sent) { sent = true; term.write(COMMAND); }
    if (output.includes(MARKER)) finish(0, 'node-pty OK: spawned cmd.exe and read its output.');
  });
  term.onExit(({ exitCode }) => finish(1, `cmd.exe exited early (code ${exitCode}). Output:\n${output}`));
  setTimeout(() => finish(1, `Timed out waiting for "${MARKER}". Output:\n${output}`), TIMEOUT_MS);
}

if (process.versions.electron) checkPty(process.argv[2]);
else runInPackagedApp();
