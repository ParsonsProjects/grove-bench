/**
 * PR actions from the branch popup: merge (squash, merge commit or rebase,
 * or bypassing the base branch's rules where the account may), auto-merge
 * on and off, ready for review and back to draft, close and reopen, update
 * the branch from its base, and delete the branch on GitHub after a merge.
 * Each runs gh in the project folder, as the other PR calls do (gh.ts).
 *
 * What the popup may offer comes from one GraphQL query (prActionOptions):
 * the repository's merge settings, and what the account may do to the PR.
 * `gh pr view --json` has neither.
 *
 * A merge passes --match-head-commit with the commit the user saw, so a push
 * meanwhile makes GitHub refuse it rather than merge unseen commits. It
 * never passes --delete-branch, which deletes the local branch too ("Delete
 * the local and remote branch after merge"), and that branch is checked out
 * in the thread's worktree: the branch goes on GitHub only (deletePrBranch),
 * and not while another open PR is based on it.
 */
import { gh, ghReason, isRateLimitError, GH_API_LIMIT_MESSAGE } from './gh.js';
import { MERGE_METHODS, type MergeMethod, type PrActionOptions, type PrBranchResult, type PrMergeRequest } from '../shared/types.js';

/** Changes on GitHub can be slow to answer; a merge waits on its checks. */
export const PR_ACTION_TIMEOUT_MS = 60_000;

const OPTIONS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed autoMergeAllowed deleteBranchOnMerge
    pullRequest(number: $number) {
      viewerCanMergeAsAdmin viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanUpdateBranch viewerCanDeleteHeadRef
    }
    pullRequests(baseRefName: $head, states: [OPEN], first: 1) { totalCount }
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

const flag = (value: unknown) => value === true;

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
    canMergeAsAdmin: flag(pr.viewerCanMergeAsAdmin),
    canEnableAutoMerge: flag(pr.viewerCanEnableAutoMerge),
    canDisableAutoMerge: flag(pr.viewerCanDisableAutoMerge),
    canUpdateBranch: flag(pr.viewerCanUpdateBranch),
    canDeleteBranch: flag(pr.viewerCanDeleteHeadRef),
    stackedPrs: typeof stacked === 'number' && stacked > 0 ? stacked : 0,
  };
}

/** What the popup may offer for PR `number`, whose branch is `head`. */
export async function prActionOptions(repoPath: string, number: number, head: string): Promise<PrActionOptions> {
  const out = await run([
    'api', 'graphql',
    '-f', `query=${OPTIONS_QUERY}`,
    '-F', 'owner={owner}', '-F', 'repo={repo}',
    '-F', `number=${number}`, '-f', `head=${head}`,
  ], repoPath);
  return parseActionOptions(JSON.parse(out));
}

/** Merge a PR the user confirmed, then delete its branch on GitHub if
 *  asked (deletePrBranch). The merge is what matters: a branch that couldn't
 *  go is reported, not thrown. */
export async function prMerge(repoPath: string, req: PrMergeRequest, head?: string): Promise<PrBranchResult> {
  await run([
    'pr', 'merge', String(req.number), `--${req.method}`,
    '--match-head-commit', req.headSha,
    ...(req.admin ? ['--admin'] : []),
  ], repoPath);
  if (!req.deleteBranch || !head) return {};
  try {
    return await deletePrBranch(repoPath, head);
  } catch (e) {
    return { branchKept: `Merged, but the branch couldn't be deleted: ${(e as Error).message}` };
  }
}

/** Delete a merged PR's branch on GitHub, unless an open PR is based on it.
 *  One already gone (the repository deletes merged branches itself) counts
 *  as deleted. */
export async function deletePrBranch(repoPath: string, branch: string): Promise<PrBranchResult> {
  const stacked = JSON.parse(await run(['pr', 'list', '--base', branch, '--state', 'open', '--json', 'number', '--limit', '1'], repoPath)) as unknown[];
  if (stacked.length > 0) return { branchKept: `Kept ${branch}: another open PR is based on it.` };
  const ref = branch.split('/').map(encodeURIComponent).join('/');
  try {
    await run(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${ref}`], repoPath);
  } catch (e) {
    if (/Reference does not exist/i.test((e as Error).message)) return { branchDeleted: true };
    throw e;
  }
  return { branchDeleted: true };
}

/** Turn auto-merge on (merging with `method` once nothing stops it) or off. */
export async function prSetAutoMerge(repoPath: string, number: number, on: boolean, method: MergeMethod = 'squash'): Promise<void> {
  await run(['pr', 'merge', String(number), ...(on ? ['--auto', `--${method}`] : ['--disable-auto'])], repoPath);
}

/** Mark a draft ready for review, or turn the PR back into a draft. */
export async function prSetDraft(repoPath: string, number: number, draft: boolean): Promise<void> {
  await run(['pr', 'ready', String(number), ...(draft ? ['--undo'] : [])], repoPath);
}

/** Close a PR without merging it, or reopen it. */
export async function prSetOpen(repoPath: string, number: number, open: boolean): Promise<void> {
  await run(['pr', open ? 'reopen' : 'close', String(number)], repoPath);
}

/** Bring the PR's branch up to date with its base on GitHub: a merge of
 *  the base into it, or a rebase onto it. */
export async function prUpdateBranch(repoPath: string, number: number, rebase: boolean): Promise<void> {
  await run(['pr', 'update-branch', String(number), ...(rebase ? ['--rebase'] : [])], repoPath);
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
