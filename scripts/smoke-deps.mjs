/**
 * Smoke test for the packaged app: every package the main process loads at
 * run time is in the app, with its own dependencies. Vite bundles everything
 * else, so those packages are the only ones the installer needs; a package
 * missing here means the app fails at start or when first starting an agent.
 *
 * The packages are read from the built main bundle itself (its require()
 * calls and the agent SDK's dynamic import), so a new one is covered without
 * editing this list. The SDK is also imported, as the app loads it: an ES
 * module can't be checked by its package.json alone.
 *
 * Usage (after `npm run dist`): node scripts/smoke-deps.mjs [out-dir]
 *
 * Re-runs itself inside the packaged app with ELECTRON_RUN_AS_NODE=1, so
 * files are read through Electron's asar support, as the app reads them.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function runInPackagedApp() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(process.argv[2] ?? path.join(root, 'out'));
  // Windows is what ships; Linux lets the check run on a dev machine too.
  const [dir, exe] = process.platform === 'win32' ? ['win-unpacked', 'Grove Bench.exe'] : ['linux-unpacked', 'grove-bench'];
  const result = spawnSync(path.join(outDir, dir, exe), [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

/** Package name from a specifier: `a/b` → `a`, `@s/a/b` → `@s/a`. */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Packages the bundled main process loads from node_modules. */
function externalsOf(mainDir) {
  const builtins = new Set(builtinModules);
  const found = new Set();
  for (const file of fs.readdirSync(mainDir).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(mainDir, file), 'utf8');
    for (const [, spec] of code.matchAll(/\brequire\("([^"./][^"]*)"\)/g)) found.add(spec);
    // The SDK is loaded with import() through new Function, so Vite leaves it alone.
    for (const [, spec] of code.matchAll(/dynamicImport[\w$]*\("([^"]+)"\)/g)) found.add(spec);
  }
  return [...found]
    .filter((s) => !s.startsWith('node:') && !builtins.has(s) && s !== 'electron')
    .map(packageName);
}

/** Where Node would find `name` when required from inside `fromDir`. */
function findPackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

async function checkPackagedDeps() {
  const appDir = path.join(path.dirname(process.execPath), 'resources', 'app.asar');
  const mainDir = path.join(appDir, 'dist', 'main');
  const roots = externalsOf(mainDir);
  console.log(`Main process loads: ${roots.join(', ')}`);

  const missing = [];
  const seen = new Set();
  const walk = (name, fromDir, via) => {
    const dir = findPackageDir(name, fromDir);
    if (!dir) { missing.push(`${name} (needed by ${via})`); return; }
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, dir, name);
    // Peer dependencies aren't followed: electron-builder doesn't package
    // them, and the SDK's are only for its type declarations (it bundles the
    // code it uses). Importing the SDK below catches one it does load.
    // Optional dependencies are per platform (the SDK's native binary): only
    // follow the ones that were installed.
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      if (findPackageDir(dep, dir)) walk(dep, dir, name);
    }
  };
  for (const name of roots) walk(name, mainDir, 'the main process');

  if (missing.length > 0) {
    console.log(`Missing from the packaged app:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  // Load the SDK as the app does: an import of the package from main.
  const sdkEntry = createRequire(path.join(mainDir, 'index.js')).resolve('@anthropic-ai/claude-agent-sdk');
  const sdk = await import(pathToFileURL(sdkEntry).href);
  if (typeof sdk.query !== 'function') {
    console.log('The agent SDK loaded, but without its query() function.');
    process.exit(1);
  }
  console.log(`Packaged dependencies OK: ${seen.size} packages, and the agent SDK loads.`);
}

if (process.versions.electron) await checkPackagedDeps();
else runInPackagedApp();
