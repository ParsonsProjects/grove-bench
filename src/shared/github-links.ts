/**
 * GitHub links Grove reads parts out of: a PR's URL and a GitHub Actions
 * check's link. The parts go into commands in the agent's prompts, so only
 * plain names and digits pass.
 */

/** An owner: letters, digits, '-' and, in enterprise managed users' names, '_'. */
const OWNER = '[A-Za-z0-9][A-Za-z0-9_-]*';
/** A repository name. It may start with '.' (org/.github); '.' and '..' alone are refused below. */
const REPO = '[A-Za-z0-9_.-]+';
const HOST = '[A-Za-z0-9.-]+';

const PR_URL = new RegExp(`^https://(${HOST})/(${OWNER})/(${REPO})/pull/(\\d{1,10})(?:[/?#]|$)`);
// After the run (and job): the end, a query, or another part that isn't a
// malformed job id.
const ACTIONS_LINK = new RegExp(`^https://(${HOST})/(${OWNER})/(${REPO})/actions/runs/(\\d{1,20})(?:/job/(\\d{1,20}))?(?=$|[?#]|/(?!job/))`);

export interface GithubRepoRef {
  host: string;
  owner: string;
  name: string;
}

/** gh's --repo form: OWNER/REPO, or HOST/OWNER/REPO off github.com. */
export function ghRepoArg(ref: GithubRepoRef): string {
  return ref.host.toLowerCase() === 'github.com' ? `${ref.owner}/${ref.name}` : `${ref.host}/${ref.owner}/${ref.name}`;
}

/** The same repository, whatever the letter case. */
export function sameRepo(a: GithubRepoRef, b: GithubRepoRef): boolean {
  return [a.host, a.owner, a.name].join('/').toLowerCase() === [b.host, b.owner, b.name].join('/').toLowerCase();
}

function repoRef(host: string, owner: string, name: string): GithubRepoRef | null {
  return name === '.' || name === '..' ? null : { host, owner, name };
}

/** The repository of a PR URL (https://HOST/OWNER/REPO/pull/N). */
export function parsePrUrl(url: string): GithubRepoRef | null {
  const m = PR_URL.exec(url);
  return m ? repoRef(m[1], m[2], m[3]) : null;
}

/** The run, and the job when the link names one, of an Actions check's
 *  link (https://HOST/OWNER/REPO/actions/runs/RUN/job/JOB). */
export function parseActionsLink(url: string): (GithubRepoRef & { runId: string; jobId?: string }) | null {
  const m = ACTIONS_LINK.exec(url);
  const ref = m ? repoRef(m[1], m[2], m[3]) : null;
  if (!m || !ref) return null;
  return { ...ref, runId: m[4], ...(m[5] ? { jobId: m[5] } : {}) };
}
