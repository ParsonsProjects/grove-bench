/**
 * Release guard, run by the Release workflow before it builds anything.
 *
 * Picks the version to release from the package.json version, the `v*` tags
 * and whether anything shipped changed since the last one (nextVersion in
 * next-version.mjs), and fails unless the commit is on main. Writes `skip`,
 * `version` and `prerelease` to $GITHUB_OUTPUT (see isGitHubPrerelease in
 * release-type.mjs). Reads the repo's releases with gh, so it needs GH_TOKEN,
 * and the full history and tags (checkout with fetch-depth: 0).
 *
 * Env: GITHUB_EVENT_NAME (`push` runs only release a package.json bump),
 * VERSION (a version asked for by hand, optional), AUTO_RELEASE (`off` skips
 * every run but one started by hand).
 *
 * Usage: GITHUB_EVENT_NAME=workflow_dispatch GH_TOKEN=... node scripts/release-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { highestVersion, nextVersion } from './next-version.mjs';
import { isGitHubPrerelease } from './release-type.mjs';

// What goes into the installer. A change anywhere else (tests, landing page,
// workflows, design docs) doesn't make a release on its own.
const SHIPPED = [
  'src',
  'docs/help',
  'index.html',
  'package.json',
  'package-lock.json',
  'electron-builder.yml',
  'vite.*.config.mjs',
  'svelte.config.mjs',
  'tsconfig.json',
  'scripts/vite-csp.mjs',
  ':(exclude)*.test.ts',
  ':(exclude)*/__mocks__/*',
];

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

function skip(reason) {
  console.log(`::notice::${reason}`);
  output({ skip: true });
  process.exit(0);
}

const event = process.env.GITHUB_EVENT_NAME;
if (process.env.AUTO_RELEASE === 'off' && event !== 'workflow_dispatch') {
  skip('Releases are paused: the repository variable AUTO_RELEASE is off.');
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { stdio: 'inherit' });
} catch (err) {
  if (err.status === 1) fail('Releases are made from main, and this commit is not on main.');
  throw err;
}

const { version: base } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const last = highestVersion(tags);

let changed = true;
if (last !== null) {
  try {
    execFileSync('git', ['diff', '--quiet', `v${last}`, 'HEAD', '--', ...SHIPPED]);
    changed = false;
  } catch (err) {
    if (err.status !== 1) throw err;
  }
}

let picked;
try {
  picked = nextVersion({ base, last, changed, bumpOnly: event === 'push', override: process.env.VERSION });
} catch (err) {
  fail(err.message);
}
if ('skip' in picked) skip(picked.skip);

// Published full releases only: a tag whose release failed, or was never
// made, doesn't count.
const repo = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
const released = JSON.parse(execFileSync('gh', [
  'release', 'list', ...repo, '--exclude-drafts', '--exclude-pre-releases', '--json', 'tagName', '--limit', '1000',
], { encoding: 'utf8' })).map((r) => r.tagName);

const { version } = picked;
const prerelease = isGitHubPrerelease(version, released);
console.log(`Releasing ${version}${prerelease ? ' as a pre-release' : ''}${last ? ` (last release ${last})` : ''}.`);
output({ skip: false, version, prerelease });
