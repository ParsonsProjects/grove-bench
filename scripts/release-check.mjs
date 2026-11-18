/**
 * Release guard, run by the Release workflow before it builds anything.
 *
 * Picks the version to release from the package.json version, the `v*` tags
 * and whether anything shipped changed since the last one (nextVersion in
 * next-version.mjs). Fails unless the commit is on main and contains the last
 * release, and when the highest tag has no published release. Writes `skip`,
 * `version` and `prerelease` to $GITHUB_OUTPUT (see isGitHubPrerelease in
 * release-type.mjs). Reads the repo's releases with gh, so it needs GH_TOKEN,
 * and the full history and tags (checkout with fetch-depth: 0).
 *
 * Env: GITHUB_EVENT_NAME (`push` runs only release a package.json bump),
 * VERSION (a version asked for by hand, optional), AUTO_RELEASE (`off` or
 * `false`, in any case, skips every run but one started by hand).
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
  ':(exclude)*-fixture.*',
  ':(exclude)*/__mocks__/*',
  // The UI kit page, served by the dev server only (ui-kit.html)
  ':(exclude)src/renderer/ui-kit',
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

/** Whether `ancestor` is `commit` or comes before it. */
function isAncestor(ancestor, commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { stdio: 'inherit' });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

const event = process.env.GITHUB_EVENT_NAME;
// Any case, and `false` too, so a pause set in a hurry still pauses.
const pause = process.env.AUTO_RELEASE?.trim() ?? '';
if (/^(off|false)$/i.test(pause) && event !== 'workflow_dispatch') {
  skip(`Releases are paused: the repository variable AUTO_RELEASE is ${pause}.`);
}

if (!isAncestor('HEAD', 'origin/main')) fail('Releases are made from main, and this commit is not on main.');

const { version: base } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const last = highestVersion(tags);

// Published releases, pre-release or not. A draft has no tag until it is
// published, so drafts don't count.
const repo = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
const releases = JSON.parse(execFileSync('gh', [
  'release', 'list', ...repo, '--exclude-drafts', '--json', 'tagName,isPrerelease', '--limit', '1000',
], { encoding: 'utf8' }));

let changed = true;
if (last !== null) {
  // This workflow only tags a release once it is published, so a tag without
  // one was pushed by hand (or its release was deleted). Counting it as the
  // last release would skip its version, or stop releases after a full one.
  if (!releases.some((r) => r.tagName === `v${last}`)) {
    fail(`Tag v${last} has no published release. The Release workflow makes its own tags: delete this one (git push --delete origin v${last}) or publish a release for it.`);
  }
  // Re-running an old run, or picking an old ref in "Run workflow", would
  // otherwise publish older code as a newer version.
  if (!isAncestor(`v${last}`, 'HEAD')) {
    fail(`This commit is older than the last release, v${last}. Release from the head of main.`);
  }
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

const { version } = picked;
const released = releases.filter((r) => !r.isPrerelease).map((r) => r.tagName);
const prerelease = isGitHubPrerelease(version, released);
console.log(`Releasing ${version}${prerelease ? ' as a pre-release' : ''}${last ? ` (last release ${last})` : ''}.`);
output({ skip: false, version, prerelease });
