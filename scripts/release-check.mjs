/**
 * Release guard, run by the Release workflow on a tag push.
 *
 * Fails unless the tag is `v` + the package.json version and the tagged commit
 * is on main. The installer name and latest.yml take their version from
 * package.json, so a tag without a matching version bump would publish an
 * installer that auto-update reads as the old version.
 *
 * Writes `version` and `prerelease` to $GITHUB_OUTPUT. A version with a
 * pre-release part (0.1.0-alpha.3) is published as a GitHub pre-release.
 *
 * Usage: GITHUB_REF_NAME=v1.2.3 node scripts/release-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_NAME;

const match = SEMVER.exec(version);
if (!match) fail(`package.json version "${version}" is not a valid semver version.`);
if (tag !== `v${version}`) {
  fail(`Tag "${tag}" does not match package.json version "${version}". Set the version in package.json on main first, then push the tag v<version>.`);
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { stdio: 'inherit' });
} catch (err) {
  if (err.status === 1) fail(`Tag "${tag}" points at a commit that is not on main.`);
  throw err;
}

const prerelease = match[1] !== undefined;
console.log(`Releasing ${version}${prerelease ? ' as a pre-release' : ''}.`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${prerelease}\n`);
}
