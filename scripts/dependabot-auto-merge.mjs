/**
 * Whether a Dependabot pull request can merge without a person, for the
 * Dependabot auto-merge workflow. Writes `merge=true|false` to
 * $GITHUB_OUTPUT.
 *
 * It can when the update is a patch or minor one, its body names no
 * maintainer change, and it only touches:
 * - landing/ or scripts/acp-spike/ (their package.json and lockfile)
 * - `uses:` lines in the workflows (GitHub Actions updates)
 * - the root package.json and lockfile, when every package it updates is
 *   test, lint or type tooling (TOOLING) and no lockfile entry it changes
 *   is one the app's other packages use. Vite bundles nearly all of those
 *   into the app, and Vite, Tailwind and electron-builder decide what goes
 *   in the installer, so anything they use ships.
 * Then it waits for every check on the pull request to finish, and says
 * yes only if they all passed, the ones its files start among them
 * (expectedChecks).
 *
 * Runs in a checkout of the pull request's merge commit with fetch-depth 2,
 * so HEAD^1 is the base it merges into.
 *
 * Usage: node scripts/dependabot-auto-merge.mjs
 * Env: UPDATE_TYPE, MAINTAINER_CHANGES, DEPENDENCY_NAMES (dependabot/fetch-metadata's
 * outputs), GITHUB_REPOSITORY, HEAD_SHA and GH_TOKEN (to read the checks).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root packages that only test, lint or type-check the code: none of them
 *  ships. Keep in step with the `tooling` group in .github/dependabot.yml
 *  (the test checks). */
export const TOOLING = [
  '@eslint/*',
  'eslint',
  'eslint-*',
  'globals',
  'typescript',
  'typescript-eslint',
  '@typescript-eslint/*',
  'vitest',
  '@vitest/*',
  'jsdom',
  'knip',
  'svelte-check',
  '@testing-library/*',
  '@types/*',
];

/** This workflow's own job, left out when waiting for the checks. */
export const OWN_CHECK = 'Approve and auto-merge';

const MERGEABLE_UPDATES = new Set(['version-update:semver-patch', 'version-update:semver-minor']);
const PASSED = new Set(['success', 'neutral', 'skipped']);
const OWN_FOLDERS = ['landing/', 'scripts/acp-spike/'];

/** Matches a package name against a pattern with `*` wildcards, which stop
 *  at `/` (as in check-release-age.mjs). */
export function matchesPattern(name, pattern) {
  const source = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${source}$`).test(name);
}

export function isTooling(name) {
  return TOOLING.some((pattern) => matchesPattern(name, pattern));
}

/** Where npm installs `dep` for the package at lockfile key `from`: the
 *  nearest node_modules folder up from it that has one, as Node finds it. */
function resolve(packages, from, dep) {
  let dir = from;
  for (;;) {
    const key = dir ? `${dir}/node_modules/${dep}` : `node_modules/${dep}`;
    if (packages[key]) return key;
    if (!dir) return null;
    const at = dir.lastIndexOf('/node_modules/');
    dir = at === -1 ? '' : dir.slice(0, at);
  }
}

/** Lockfile keys of every package the root's non-tooling packages use,
 *  directly or not. */
export function appPackages(lock) {
  const packages = lock?.packages ?? {};
  const root = packages[''] ?? {};
  const direct = Object.keys({ ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies }).filter((name) => !isTooling(name));
  const seen = new Set();
  const queue = direct.map((name) => resolve(packages, '', name)).filter(Boolean);
  while (queue.length) {
    const key = queue.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key];
    for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
      const found = resolve(packages, key, dep);
      if (found && !seen.has(found)) queue.push(found);
    }
  }
  return seen;
}

/** Lockfile keys the head adds, removes or moves to another version. */
export function changedEntries(baseLock, headLock) {
  const base = baseLock?.packages ?? {};
  const head = headLock?.packages ?? {};
  const changed = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (!key) continue;
    const a = base[key];
    const b = head[key];
    if (!a || !b || a.version !== b.version || a.resolved !== b.resolved || a.integrity !== b.integrity) changed.push(key);
  }
  return changed;
}

/** A diff line that changes something other than a step's `uses:`. */
function isOtherChange(line) {
  if (!/^[+-]/.test(line) || /^(\+\+\+|---) /.test(line)) return false;
  return !/^[+-]\s*(-\s+)?uses:\s/.test(line);
}

/**
 * The decision, without the checks: `{ merge, reason }`.
 * `files` are the paths the pull request changes, `workflowDiff` the
 * `git diff -U0` of any workflow files, and `baseLock`/`headLock` the root
 * lockfile before and after (null when it doesn't change).
 */
export function decide({ updateType, maintainerChanges, dependencyNames, files, workflowDiff = '', baseLock = null, headLock = null }) {
  if (!MERGEABLE_UPDATES.has(updateType)) return { merge: false, reason: `it's a ${updateType || 'unknown'} update, not a patch or minor one` };
  if (maintainerChanges) return { merge: false, reason: 'the pull request says a maintainer changed' };
  if (files.length === 0) return { merge: false, reason: "the changed files couldn't be listed" };

  const root = [];
  for (const file of files) {
    if (OWN_FOLDERS.some((folder) => file.startsWith(folder)) && /(^|\/)package(-lock)?\.json$/.test(file)) continue;
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) continue;
    if (file === 'package.json' || file === 'package-lock.json') { root.push(file); continue; }
    return { merge: false, reason: `it changes ${file}` };
  }

  const other = workflowDiff.split('\n').find(isOtherChange);
  if (other) return { merge: false, reason: `it changes a workflow line other than \`uses:\`: ${other.trim()}` };

  if (root.length) {
    const app = dependencyNames.filter((name) => !isTooling(name));
    if (dependencyNames.length === 0) return { merge: false, reason: "the root packages it updates couldn't be read" };
    if (app.length) return { merge: false, reason: `it updates ${app.join(', ')}, which ${app.length === 1 ? 'is' : 'are'} in the app or the build` };
    if (root.includes('package-lock.json')) {
      const used = new Set([...appPackages(baseLock), ...appPackages(headLock)]);
      const shipped = changedEntries(baseLock, headLock).filter((key) => used.has(key));
      if (shipped.length) {
        const names = shipped.slice(0, 5).map((key) => key.slice(key.lastIndexOf('node_modules/') + 13));
        return { merge: false, reason: `the lockfile also changes ${names.join(', ')}${shipped.length > 5 ? ` and ${shipped.length - 5} more` : ''}, which the app's packages use` };
      }
    }
  }
  return { merge: true, reason: 'a patch or minor update to tooling, the landing page, acp-spike or the actions' };
}

/** Checks the changed files must start, by name, so a workflow that hasn't
 *  shown up yet isn't taken for one that passed. */
export function expectedChecks(files) {
  const names = ['test', 'lint', 'Analyze (javascript-typescript)', 'Analyze (actions)'];
  if (files.some((file) => /(^|\/)(package-lock\.json|\.npmrc)$/.test(file))) {
    names.push('Check package ages', 'Audit app', 'Audit landing', 'Audit acp-spike');
  }
  if (files.includes('package.json') || files.includes('package-lock.json')) names.push('Build installer');
  if (files.some((file) => file.startsWith('landing/'))) names.push('Build landing page');
  return names;
}

/**
 * Where the checks stand: 'passed', 'waiting', or 'failed: <names>'.
 * `runs` are the head commit's latest check runs ({ name, status, conclusion }).
 */
export function checksState(runs, expected) {
  const others = runs.filter((run) => run.name !== OWN_CHECK);
  const failed = others.filter((run) => run.status === 'completed' && !PASSED.has(run.conclusion));
  if (failed.length) return `failed: ${failed.map((run) => `${run.name} (${run.conclusion})`).join(', ')}`;
  if (others.some((run) => run.status !== 'completed')) return 'waiting';
  const names = new Set(others.map((run) => run.name));
  if (expected.some((name) => !names.has(name))) return 'waiting';
  return 'passed';
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function readLock(ref) {
  try {
    return JSON.parse(ref ? git('show', `${ref}:package-lock.json`) : readFileSync('package-lock.json', 'utf8'));
  } catch {
    return null;
  }
}

function checkRuns(repo, sha) {
  const out = execFileSync('gh', ['api', '--paginate', `repos/${repo}/commits/${sha}/check-runs?per_page=100`, '--jq', '.check_runs[] | {name, status, conclusion}'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const env = process.env;
  const files = git('diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD').split('\n').map((line) => line.trim()).filter(Boolean);
  const workflows = files.filter((file) => file.startsWith('.github/workflows/'));
  const rootLock = files.includes('package-lock.json');
  let { merge, reason } = decide({
    updateType: env.UPDATE_TYPE ?? '',
    maintainerChanges: env.MAINTAINER_CHANGES === 'true',
    dependencyNames: (env.DEPENDENCY_NAMES ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    files,
    workflowDiff: workflows.length ? git('diff', '-U0', 'HEAD^1', 'HEAD', '--', ...workflows) : '',
    baseLock: rootLock ? readLock('HEAD^1') : null,
    headLock: rootLock ? readLock(null) : null,
  });

  if (merge) {
    // Long enough for the Windows jobs (about 10 minutes) and a queue.
    const expected = expectedChecks(files);
    const deadline = Date.now() + 50 * 60_000;
    let state = 'waiting';
    await sleep(30_000); // Let the other workflows' jobs show up.
    while (state === 'waiting' && Date.now() < deadline) {
      state = checksState(checkRuns(env.GITHUB_REPOSITORY, env.HEAD_SHA), expected);
      if (state === 'waiting') await sleep(30_000);
    }
    if (state !== 'passed') {
      merge = false;
      reason = state === 'waiting' ? 'its checks were still running after 50 minutes' : `its checks ${state}`;
    }
  }

  console.log(merge ? `Merging: ${reason}.` : `Leaving it for a review: ${reason}.`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `merge=${merge}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`Leaving it for a review: ${err.message}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'merge=false\n');
  });
}
