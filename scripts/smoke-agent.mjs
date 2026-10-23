/**
 * Smoke test for the packaged app: finds the agent SDK's native `claude`
 * binary the way the SDK does (next to its own module, inside app.asar),
 * runs it from app.asar.unpacked the way the app's spawn hook does, and
 * checks it prints its version. Catches the binary missing from the unpacked
 * files, or failing to start, before an installer is published.
 *
 * Usage (after `npm run dist`): node scripts/smoke-agent.mjs [out-dir]
 *
 * Re-runs itself inside the packaged app with ELECTRON_RUN_AS_NODE=1, so the
 * lookup goes through Electron's asar support, as it does in the app.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 60_000;

function runInPackagedApp() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(process.argv[2] ?? path.join(root, 'out'));
  // Windows is what ships; Linux lets the check run on a dev machine too.
  const [dir, exe] = process.platform === 'win32' ? ['win-unpacked', 'Grove Bench.exe'] : ['linux-unpacked', 'grove-bench'];
  const result = spawnSync(path.join(outDir, dir, exe), [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: TIMEOUT_MS + 10_000,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function checkAgentBinary() {
  const resources = path.join(path.dirname(process.execPath), 'resources');
  const sdkModule = path.join(resources, 'app.asar', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const candidates = process.platform === 'linux' ? [base, `${base}-musl`] : [base];

  const require = createRequire(sdkModule);
  let found;
  for (const pkg of candidates) {
    try { found = require.resolve(`${pkg}/${exe}`); break; } catch { /* try the next */ }
  }
  if (!found) {
    console.log(`No ${candidates.join(' or ')} package in the app: the agent can't start.`);
    process.exit(1);
  }
  // As asarUnpackedPath in src/main/adapters/claude-code.ts.
  const runnable = found.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
  const run = spawnSync(runnable, ['--version'], { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true });
  if (run.error || run.status !== 0) {
    console.log(`Agent binary failed to run from ${runnable}: ${run.error?.message ?? `exit ${run.status}`}\n${run.stdout ?? ''}${run.stderr ?? ''}`);
    process.exit(1);
  }
  console.log(`Agent binary OK: ${run.stdout.trim()} (${runnable})`);
}

if (process.versions.electron) checkAgentBinary();
else runInPackagedApp();
