const RELEASES_URL = 'https://github.com/ParsonsProjects/grove-bench/releases';

/** GitHub release page for a version (tags are `v<version>`), or the list of
 *  all releases. */
export function releaseNotesUrl(version?: string): string {
  return version ? `${RELEASES_URL}/tag/v${encodeURIComponent(version)}` : RELEASES_URL;
}
