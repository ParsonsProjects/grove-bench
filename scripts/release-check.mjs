/**
 * Release guard, run by the Release workflow on a tag push.
 *
 * Fails unless the tag is `v` + the package.json version and the tagged commit
 * is on main. The installer name and latest.yml take their version from
 * package.json, so a tag without a matching version bump would publish an
 * installer that auto-update reads as the old version.
 *
 * Writes `version` and `prerelease` to $GITHUB_OUTPUT (see
 * isGitHubPrerelease in release-type.mjs). Reads the repo's releases with gh,
 * so it needs GH_TOKEN.
 *
 * Usage: GITHUB_REF_NAME=v1.2.3 GH_TOKEN=... node scripts/release-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { SEMVER, isGitHubPrerelease } from './release-type.mjs';

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_NAME;

if (!SEMVER.test(version)) fail(`package.json version "${version}" is not a valid semver version.`);
if (tag !== `v${version}`) {
  fail(`Tag "${tag}" does not match package.json version "${version}". Set the version in package.json on main first, then push the tag v<version>.`);
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { stdio: 'inherit' });
} catch (err) {
  if (err.status === 1) fail(`Tag "${tag}" points at a commit that is not on main.`);
  throw err;
}

// Published full releases only: a tag whose release failed, or was never
// made, doesn't count.
const repo = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
const released = JSON.parse(execFileSync('gh', [
  'release', 'list', ...repo, '--exclude-drafts', '--exclude-pre-releases', '--json', 'tagName', '--limit', '1000',
], { encoding: 'utf8' })).map((r) => r.tagName);

const prerelease = isGitHubPrerelease(version, released);
console.log(`Releasing ${version}${prerelease ? ' as a pre-release' : ''}.`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${prerelease}\n`);
}
