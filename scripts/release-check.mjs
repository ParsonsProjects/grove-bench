/**
 * Release guard, run by the Release workflow on a tag push.
 *
 * Fails unless the tag is `v` + the package.json version and the tagged commit
 * is on main. The installer name and latest.yml take their version from
 * package.json, so a tag without a matching version bump would publish an
 * installer that auto-update reads as the old version.
 *
 * Writes `version` and `prerelease` to $GITHUB_OUTPUT (see isGitHubPrerelease).
 *
 * Usage: GITHUB_REF_NAME=v1.2.3 node scripts/release-check.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Whether `version` is published as a GitHub pre-release, given the repo's
 * tags. GitHub's "Latest" badge and /releases/latest skip pre-releases, so
 * until a full version (1.2.3) is tagged, pre-release versions (0.1.0-alpha.3)
 * go out as full releases: otherwise "Latest" stays on an old build and people
 * download it. After that, they are pre-releases again, so installs of a full
 * version, which update from /releases/latest, don't get them. Installs of a
 * pre-release version read the releases feed and don't look at the flag
 * (electron-updater GitHubProvider.getLatestVersion).
 */
export function isGitHubPrerelease(version, tags) {
  if (SEMVER.exec(version)?.[1] === undefined) return false;
  return tags.some((tag) => {
    const match = SEMVER.exec(tag.replace(/^v/, ''));
    return match !== null && match[1] === undefined;
  });
}

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

function main() {
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

  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const prerelease = isGitHubPrerelease(version, tags);
  console.log(`Releasing ${version}${prerelease ? ' as a pre-release' : ''}.`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nprerelease=${prerelease}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
