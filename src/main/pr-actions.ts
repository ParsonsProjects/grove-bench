/**
 * PR actions from the branch popup: merge (squash, merge commit or rebase,
 * or bypassing the base branch's rules where the account may), auto-merge
 * on and off, ready for review and back to draft, close and reopen, update
 * the branch from its base, and delete the branch on GitHub after a merge.
 *
 * Each names the PR's repository and host, read from its URL (prTarget):
 * `gh pr` commands take --repo, and `gh api` --hostname with the owner and
 * name spelled out. Left to gh, the folder's remotes (a fork clone's
 * upstream, say) or GH_HOST would choose.
 *
 * What the popup may offer comes from one GraphQL query (prActionOptions):
 * the repository's merge settings, and what the account may do to the PR.
 * `gh pr view --json` has neither.
 *
 * A merge passes --match-head-commit with the commit the user saw, so a push
 * meanwhile makes GitHub refuse it rather than merge unseen commits. Then it
 * asks GitHub whether the PR merged: on a base branch with a merge queue, gh
 * only adds it to the queue. It never passes --delete-branch, which deletes
 * the local branch too ("Delete the local and remote branch after merge"),
 * and that branch is checked out in the thread's worktree: the branch goes
 * on GitHub only (deletePrBranch), and only once nothing needs it.
 */
import { gh, ghReason, isRateLimitError, GH_API_LIMIT_MESSAGE } from './gh.js';
import { ghRepoArg, parsePrUrl, type GithubRepoRef } from '../shared/github-links.js';
import { MERGE_METHODS, type MergeMethod, type PrActionOptions, type PrActionResult, type PrMergeRequest } from '../shared/types.js';

/** Changes on GitHub can be slow to answer; a merge waits on its checks. */
export const PR_ACTION_TIMEOUT_MS = 60_000;

/** A PR an action is for, with the repository its URL names. */
export interface PrTarget {
  number: number;
  repo: GithubRepoRef;
}

const OPTIONS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed autoMergeAllowed deleteBranchOnMerge viewerPermission
    pullRequest(number: $number) {
      viewerCanMergeAsAdmin viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanUpdateBranch
      isCrossRepository isMergeQueueEnabled
    }
    pullRequests(baseRefName: $head, states: [OPEN], first: 1) { totalCount }
  }
}`;

/** Where a PR stands after `gh pr merge`. */
const STATE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { state isInMergeQueue autoMergeRequest { enabledAt } }
  }
}`;

/** What deleting a merged PR's branch would touch: the PR, the branch as it
 *  is now, and open PRs from it or onto it. */
const BRANCH_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $ref: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { state isCrossRepository headRefName headRefOid }
    ref(qualifiedName: $ref) { target { oid } associatedPullRequests(states: [OPEN]) { totalCount } }
    pullRequests(baseRefName: $branch, states: [OPEN], first: 1) { totalCount }
  }
}`;

/** A PR number gh can be given: digits only. */
export function isPrNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e9;
}

export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === 'string' && (MERGE_METHODS as readonly string[]).includes(value);
}

/** A commit gh's --match-head-commit takes: a hex SHA. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value);
}

/** The PR a renderer call names ({ number, url }), when its URL is a PR's
 *  and the number matches it; null otherwise. */
export function prTarget(value: unknown): PrTarget | null {
  const v = (value ?? {}) as { number?: unknown; url?: unknown };
  if (!isPrNumber(v.number) || typeof v.url !== 'string') return null;
  const repo = parsePrUrl(v.url);
  const inUrl = /\/pull\/(\d+)/.exec(v.url)?.[1];
  return repo && Number(inUrl) === v.number ? { number: v.number, repo } : null;
}

const flag = (value: unknown) => value === true;
const PUSH_PERMISSIONS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

/** The GraphQL answer as PrActionOptions. Missing or odd fields read as
 *  "not allowed", so nothing is offered that GitHub may refuse. */
export function parseActionOptions(json: unknown): PrActionOptions {
  const repo = (json as { data?: { repository?: Record<string, unknown> } } | null)?.data?.repository ?? {};
  const pr = (repo.pullRequest ?? {}) as Record<string, unknown>;
  const allowed: Record<MergeMethod, boolean> = {
    squash: flag(repo.squashMergeAllowed),
    merge: flag(repo.mergeCommitAllowed),
    rebase: flag(repo.rebaseMergeAllowed),
  };
  const stacked = (repo.pullRequests as { totalCount?: unknown } | undefined)?.totalCount;
  return {
    methods: MERGE_METHODS.filter((m) => allowed[m]),
    deleteBranchOnMerge: flag(repo.deleteBranchOnMerge),
    autoMergeAllowed: flag(repo.autoMergeAllowed),
    mergeQueue: flag(pr.isMergeQueueEnabled),
    canMergeAsAdmin: flag(pr.viewerCanMergeAsAdmin),
    canEnableAutoMerge: flag(pr.viewerCanEnableAutoMerge),
    canDisableAutoMerge: flag(pr.viewerCanDisableAutoMerge),
    canUpdateBranch: flag(pr.viewerCanUpdateBranch),
    // Not viewerCanDeleteHeadRef: what that says before a merge isn't
    // documented (its description is viewerCanRestoreHeadRef's).
    canDeleteBranch: pr.isCrossRepository === false && typeof repo.viewerPermission === 'string' && PUSH_PERMISSIONS.has(repo.viewerPermission),
    stackedPrs: typeof stacked === 'number' && stacked > 0 ? stacked : 0,
  };
}

/** What the popup may offer for PR `target`, whose branch is `head`. */
export async function prActionOptions(repoPath: string, target: PrTarget, head: string): Promise<PrActionOptions> {
  return parseActionOptions(await graphql(repoPath, target, OPTIONS_QUERY, { head }));
}

/** Merge a PR the user confirmed, then delete its branch on GitHub if asked
 *  (deletePrBranch). The merge is what matters: a branch that couldn't go
 *  is reported, not thrown. On a base branch with a merge queue, gh adds the
 *  PR to the queue instead, and the branch stays for the queue to merge. */
export async function prMerge(repoPath: string, target: PrTarget, req: PrMergeRequest, head?: string): Promise<PrActionResult> {
  await run([
    'pr', 'merge', String(target.number), '--repo', ghRepoArg(target.repo), `--${req.method}`,
    '--match-head-commit', req.headSha,
    ...(req.admin ? ['--admin'] : []),
  ], repoPath);

  let state: { state?: unknown; isInMergeQueue?: unknown; autoMergeRequest?: unknown } | undefined;
  try {
    state = ((await graphql(repoPath, target, STATE_QUERY, {})) as { data?: { repository?: { pullRequest?: typeof state } } })
      .data?.repository?.pullRequest;
  } catch {
    return { note: 'GitHub took the merge but didn\'t say whether it\'s done. The branch is kept.' };
  }
  if (state?.state !== 'MERGED') {
    if (state?.isInMergeQueue === true) return { note: 'In the merge queue: GitHub merges it when its turn comes.' };
    if (state?.autoMergeRequest) return { note: 'GitHub turned on auto-merge: it merges once nothing stops it.' };
    return { note: 'GitHub hasn\'t merged it yet. The branch is kept.' };
  }
  if (!req.deleteBranch || !head) return { merged: true };
  try {
    return { merged: true, ...(await deletePrBranch(repoPath, target, head)) };
  } catch (e) {
    return { merged: true, note: `Merged, but the branch couldn't be deleted: ${(e as Error).message}` };
  }
}

/** Delete merged PR `target`'s branch on GitHub, but only while it is
 *  still the commit GitHub merged, nothing else uses it, and it is in this
 *  repository. Otherwise it's kept, and `note` says why. One already gone
 *  (the repository deletes merged branches itself) counts as deleted. */
export async function deletePrBranch(repoPath: string, target: PrTarget, branch: string): Promise<PrActionResult> {
  const answer = await graphql(repoPath, target, BRANCH_QUERY, { ref: `refs/heads/${branch}`, branch }) as {
    data?: { repository?: {
      pullRequest?: { state?: string; isCrossRepository?: boolean; headRefName?: string; headRefOid?: string } | null;
      ref?: { target?: { oid?: string } | null; associatedPullRequests?: { totalCount?: number } } | null;
      pullRequests?: { totalCount?: number };
    } };
  };
  const repo = answer.data?.repository;
  const pr = repo?.pullRequest;
  const n = `#${target.number}`;
  if (!repo || !pr) throw new Error(`GitHub didn't find ${n}`);
  if (pr.headRefName !== branch) throw new Error(`${branch} isn't ${n}'s branch`);
  if (pr.state !== 'MERGED') return { note: `Kept ${branch}: ${n} isn't merged.` };
  if (pr.isCrossRepository !== false) return { note: `Kept ${branch}: it's in a fork, not this repository.` };
  if (!repo.ref) return { branchDeleted: true };
  if (!pr.headRefOid || repo.ref.target?.oid !== pr.headRefOid) return { note: `Kept ${branch}: it has commits ${n} didn't merge.` };
  if ((repo.ref.associatedPullRequests?.totalCount ?? 1) > 0) return { note: `Kept ${branch}: an open PR comes from it.` };
  if ((repo.pullRequests?.totalCount ?? 1) > 0) return { note: `Kept ${branch}: another open PR is based on it.` };

  const ref = branch.split('/').map(encodeURIComponent).join('/');
  try {
    await run(['api', '--hostname', target.repo.host, '-X', 'DELETE', `repos/${target.repo.owner}/${target.repo.name}/git/refs/heads/${ref}`], repoPath);
  } catch (e) {
    if (/Reference does not exist/i.test((e as Error).message)) return { branchDeleted: true };
    throw e;
  }
  return { branchDeleted: true };
}

/** Turn auto-merge on (merging with `method` once nothing stops it) or off. */
export async function prSetAutoMerge(repoPath: string, target: PrTarget, on: boolean, method: MergeMethod = 'squash'): Promise<void> {
  await run(['pr', 'merge', ...prArgs(target), ...(on ? ['--auto', `--${method}`] : ['--disable-auto'])], repoPath);
}

/** Mark a draft ready for review, or turn the PR back into a draft. */
export async function prSetDraft(repoPath: string, target: PrTarget, draft: boolean): Promise<void> {
  await run(['pr', 'ready', ...prArgs(target), ...(draft ? ['--undo'] : [])], repoPath);
}

/** Close a PR without merging it, or reopen it. */
export async function prSetOpen(repoPath: string, target: PrTarget, open: boolean): Promise<void> {
  await run(['pr', open ? 'reopen' : 'close', ...prArgs(target)], repoPath);
}

/** Bring the PR's branch up to date with its base on GitHub: a merge of
 *  the base into it, or a rebase onto it. */
export async function prUpdateBranch(repoPath: string, target: PrTarget, rebase: boolean): Promise<void> {
  await run(['pr', 'update-branch', ...prArgs(target), ...(rebase ? ['--rebase'] : [])], repoPath);
}

function prArgs(target: PrTarget): string[] {
  return [String(target.number), '--repo', ghRepoArg(target.repo)];
}

/** A GraphQL query about PR `target`, on its host and repository. */
async function graphql(repoPath: string, target: PrTarget, query: string, vars: Record<string, string>): Promise<unknown> {
  const out = await run([
    'api', 'graphql', '--hostname', target.repo.host,
    '-f', `query=${query}`,
    '-f', `owner=${target.repo.owner}`, '-f', `repo=${target.repo.name}`,
    '-F', `number=${target.number}`,
    ...Object.entries(vars).flatMap(([k, v]) => ['-f', `${k}=${v}`]),
  ], repoPath);
  return JSON.parse(out);
}

/** Run gh for an action the user asked for, failing with GitHub's reason. */
async function run(args: string[], repoPath: string): Promise<string> {
  try {
    return await gh(args, repoPath, undefined, { timeout: PR_ACTION_TIMEOUT_MS });
  } catch (e) {
    if (isRateLimitError(e)) throw new Error(GH_API_LIMIT_MESSAGE, { cause: e });
    throw new Error(ghReason(e), { cause: e });
  }
}
