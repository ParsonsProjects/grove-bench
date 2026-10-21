/**
 * Whether a release goes out as a GitHub pre-release. Kept apart from
 * release-check.mjs so tests can import it without running the release guard.
 */

export const SEMVER = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Whether `version` is published as a GitHub pre-release, given the tags of
 * the repo's published full (not pre-release, not draft) GitHub releases.
 * GitHub's "Latest" badge and /releases/latest skip pre-releases, so until a
 * full version (1.2.3) has been released, pre-release versions
 * (0.1.0-alpha.3) go out as full releases: otherwise "Latest" stays on an old
 * build and people download it. After that, they are pre-releases again, so
 * installs of a full version, which update from /releases/latest, don't get
 * them. Installs of a pre-release version read the releases feed and don't
 * look at the flag (electron-updater GitHubProvider.getLatestVersion).
 */
export function isGitHubPrerelease(version, releasedTags) {
  if (SEMVER.exec(version)?.[1] === undefined) return false;
  return releasedTags.some((tag) => {
    const match = SEMVER.exec(tag.replace(/^v/, ''));
    return match !== null && match[1] === undefined;
  });
}
