/**
 * Dependency age guard, run by the Dependency age workflow on pull requests.
 *
 * Fails if a package-lock.json adds or changes a package version published
 * less than `min-release-age` days ago, read from the .npmrc next to that
 * lockfile. npm applies min-release-age only when it picks a version, so
 * `npm ci` installs whatever the lockfile pins, however new. This covers
 * lockfiles written by an older npm, by a bot or by hand.
 *
 * Packages matching `min-release-age-exclude[]` in the same .npmrc are
 * skipped, as npm skips them.
 *
 * Usage: node scripts/check-release-age.mjs <base-ref> [lockfile...]
 * Lockfiles default to package-lock.json and landing/package-lock.json.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCKFILES = ['package-lock.json', 'landing/package-lock.json'];
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const CONCURRENCY = 8;

/** Reads the settings this check needs from .npmrc text. */
export function parseNpmrc(text) {
  const config = { minReleaseAge: null, exclude: [], registry: DEFAULT_REGISTRY };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key === 'min-release-age') config.minReleaseAge = Number(value);
    else if (key === 'min-release-age-exclude[]' || key === 'min-release-age-exclude') config.exclude.push(value);
    else if (key === 'registry') config.registry = value.endsWith('/') ? value : `${value}/`;
  }
  return config;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches a package name against an exclude pattern. Supports `*` (stops at `/`, as in minimatch) and `**`. */
export function matchesPattern(name, pattern) {
  const source = pattern
    .split('**')
    .map((part) => part.split('*').map(escapeRegExp).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`).test(name);
}

/** The name the registry knows an entry by: aliases carry `name`, other entries use their folder. */
function packageName(key, entry) {
  return entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/**
 * Registry packages that the head lockfile adds, or moves to another version,
 * compared with the base lockfile (null when the lockfile is new). Returns
 * unique { name, version } pairs.
 */
export function changedPackages(baseLock, headLock, registry = DEFAULT_REGISTRY) {
  const basePackages = baseLock?.packages ?? {};
  const changed = new Map();
  for (const [key, entry] of Object.entries(headLock.packages ?? {})) {
    // Skip the root project, workspace links, bundled dependencies (they ship
    // inside their parent's tarball) and anything not from the registry.
    if (!key || entry.link || entry.inBundle || !entry.version) continue;
    if (!entry.resolved?.startsWith(registry)) continue;
    const name = packageName(key, entry);
    const base = basePackages[key];
    if (base && base.version === entry.version && packageName(key, base) === name) continue;
    changed.set(`${name}@${entry.version}`, { name, version: entry.version });
  }
  return [...changed.values()];
}

async function forEachLimited(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Checks each package's publish time against the age limit, the way npm does:
 * a version is allowed if it was published on or before now minus
 * `minReleaseAge` days. `fetchTime(name, version)` resolves to an ISO date
 * string, or null when the registry has no time for that version.
 */
export async function checkAges(packages, { minReleaseAge, exclude = [], now, fetchTime }) {
  const cutoff = now - minReleaseAge * DAY_MS;
  const toCheck = packages.filter((pkg) => !exclude.some((pattern) => matchesPattern(pkg.name, pattern)));
  const tooNew = [];
  const errors = [];
  await forEachLimited(toCheck, CONCURRENCY, async (pkg) => {
    try {
      const time = await fetchTime(pkg.name, pkg.version);
      if (!time) {
        errors.push({ ...pkg, message: 'the registry has no publish time for this version' });
        return;
      }
      const published = Date.parse(time);
      if (published > cutoff) {
        tooNew.push({ ...pkg, published, allowedFrom: published + minReleaseAge * DAY_MS });
      }
    } catch (err) {
      errors.push({ ...pkg, message: err.message });
    }
  });
  const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  return { tooNew: tooNew.sort(byName), errors: errors.sort(byName), checked: toCheck.length, excluded: packages.length - toCheck.length };
}

/**
 * Returns a fetchTime function that reads publish times from the registry's
 * full package document (the abbreviated one has no `time` field), fetching
 * each package once.
 */
export function registryTimes(registry = DEFAULT_REGISTRY) {
  const documents = new Map();
  const load = async (name) => {
    const url = registry + name.replace('/', '%2f');
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { headers: { accept: 'application/json' } });
      } catch (err) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 2000)); continue; }
        throw new Error(`${url}: ${err.message}`);
      }
      if (res.ok) return (await res.json()).time ?? {};
      if (res.status >= 500 && attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 2000)); continue; }
      throw new Error(`${url} returned HTTP ${res.status}`);
    }
  };
  return async (name, version) => {
    if (!documents.has(name)) documents.set(name, load(name));
    return (await documents.get(name))[version] ?? null;
  };
}

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

function gitShow(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Not in the base: every entry counts as added.
    return null;
  }
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const [baseRef, ...lockfiles] = process.argv.slice(2);
  if (!baseRef) fail('Usage: node scripts/check-release-age.mjs <base-ref> [lockfile...]');
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    fail(`Base ref "${baseRef}" not found. Fetch it first.`);
  }

  const now = Date.now();
  let failed = false;
  for (const lockfile of lockfiles.length ? lockfiles : DEFAULT_LOCKFILES) {
    const lockPath = path.join(ROOT, lockfile);
    if (!fs.existsSync(lockPath)) continue;
    const npmrcPath = path.join(path.dirname(lockPath), '.npmrc');
    const npmrcName = path.relative(ROOT, npmrcPath).split(path.sep).join('/');
    const npmrc = parseNpmrc(fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '');
    if (npmrc.minReleaseAge === null || npmrc.minReleaseAge === 0) {
      console.log(`${lockfile}: no min-release-age in ${npmrcName}, skipped.`);
      continue;
    }
    if (!Number.isFinite(npmrc.minReleaseAge) || npmrc.minReleaseAge < 0) {
      fail(`${npmrcName}: min-release-age must be a number of days.`);
    }

    const baseText = gitShow(baseRef, path.relative(ROOT, lockPath).split(path.sep).join('/'));
    const headLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const packages = changedPackages(baseText ? JSON.parse(baseText) : null, headLock, npmrc.registry);
    const result = await checkAges(packages, { ...npmrc, now, fetchTime: registryTimes(npmrc.registry) });

    console.log(
      `${lockfile}: ${packages.length} added or changed, ${result.excluded} excluded, ` +
      `${result.tooNew.length} newer than ${npmrc.minReleaseAge} days.`,
    );
    for (const pkg of result.tooNew) {
      failed = true;
      console.log(
        `::error file=${lockfile}::${pkg.name}@${pkg.version} was published on ${day(pkg.published)}, ` +
        `less than ${npmrc.minReleaseAge} days ago. Use an older version, wait until ${day(pkg.allowedFrom)}, ` +
        `or add min-release-age-exclude[]=${pkg.name} to ${npmrcName}.`,
      );
    }
    for (const pkg of result.errors) {
      failed = true;
      console.log(`::error file=${lockfile}::Could not check ${pkg.name}@${pkg.version}: ${pkg.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err.stack ?? String(err)));
}
