import { execa } from 'execa';
import type { PrChecksSummary, PrCreateOpts, PrInfo, PrReviewComment } from '../shared/types.js';

/** gh can sit forever on a stalled connection or an interactive prompt. The
 *  renderer polls PR status for every session in sequence, so one hung call
 *  would freeze the sweep for all of them; a bounded call fails instead and
 *  the next sweep retries. */
export const GH_TIMEOUT_MS = 30_000;

export async function gh(args: string[], cwd?: string): Promise<string> {
  const result = await execa('gh', args, { ...(cwd ? { cwd } : {}), timeout: GH_TIMEOUT_MS });
  return result.stdout;
}

/** gh's "there is no PR for this branch" failure, as opposed to a network,
 *  auth, or timeout failure. */
export function isNoPrError(e: unknown): boolean {
  const err = e as { stderr?: unknown; message?: unknown } | null;
  const text = `${typeof err?.stderr === 'string' ? err.stderr : ''}\n${typeof err?.message === 'string' ? err.message : ''}`;
  return /no pull requests found|could not resolve to a PullRequest/i.test(text);
}

export async function ghVersion(): Promise<string | null> {
  try {
    const out = await gh(['--version']);
    const match = out.match(/gh version (\S+)/);
    return match ? match[1] : out.split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

export async function ghAuthenticated(): Promise<boolean> {
  try {
    await gh(['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

let cachedLogin: string | null = null;

/** The gh-authenticated user's login, cached after the first success.
 *  Failures (not authenticated, offline) return null without caching, so a
 *  later login is picked up. */
export async function ghLogin(): Promise<string | null> {
  if (cachedLogin) return cachedLogin;
  try {
    const login = JSON.parse(await gh(['api', 'user']))?.login;
    if (typeof login === 'string' && login) cachedLogin = login;
  } catch {
    return null;
  }
  return cachedLogin;
}

export function resetGhLoginCacheForTests(): void {
  cachedLogin = null;
}

const PR_VIEW_FIELDS = 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews,headRefName,baseRefName';
/** Upper bound on PRs read per head branch. A branch rarely has more than a
 *  handful (GitHub allows one open PR per head+base pair); the rest are history. */
const PR_LIST_LIMIT = 20;

const PASSED_VERDICTS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED_VERDICTS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function checkVerdict(item: Record<string, unknown>): string {
  return String(item.conclusion || item.state || '').toUpperCase();
}

/** Names of the failing checks in a statusCheckRollup array. */
export function failingCheckNames(rollup: unknown): string[] {
  if (!Array.isArray(rollup)) return [];
  return (rollup as Array<Record<string, unknown>>)
    .filter((item) => FAILED_VERDICTS.has(checkVerdict(item)))
    .map((item) => String(item.name || item.context || 'check'));
}

/** Opaque ids for conversation comments + submitted reviews, for new-feedback detection.
 *  ignoreLogin drops entries authored by that user (the gh-authenticated account):
 *  the agent replying on the PR must not read as new feedback, or auto
 *  address-reviews mode would answer its own replies in a loop. */
export function commentSignature(comments: unknown, reviews: unknown, ignoreLogin?: string | null): string[] {
  const sig: string[] = [];
  if (Array.isArray(comments)) {
    for (const c of comments as Array<Record<string, any>>) {
      if (ignoreLogin && c.author?.login === ignoreLogin) continue;
      sig.push(`c:${c.id ?? `${c.author?.login}@${c.createdAt}`}`);
    }
  }
  if (Array.isArray(reviews)) {
    for (const r of reviews as Array<Record<string, any>>) {
      if (String(r.state).toUpperCase() === 'PENDING') continue;
      if (ignoreLogin && r.author?.login === ignoreLogin) continue;
      sig.push(`r:${r.id ?? `${r.author?.login}@${r.submittedAt}`}`);
    }
  }
  return sig;
}

/** Fold gh's statusCheckRollup array into pass/fail/pending counts. */
export function summarizeChecks(rollup: unknown): PrChecksSummary | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  const summary: PrChecksSummary = { total: rollup.length, passed: 0, failed: 0, pending: 0 };
  for (const item of rollup as Array<Record<string, unknown>>) {
    // CheckRun rows carry status/conclusion; StatusContext rows carry state.
    const verdict = String(item.conclusion || item.state || '').toUpperCase();
    if (PASSED_VERDICTS.has(verdict)) summary.passed++;
    else if (FAILED_VERDICTS.has(verdict)) summary.failed++;
    else summary.pending++;
  }
  return summary;
}

/** Shape one gh PR JSON object into PrInfo; null when it isn't a PR. */
function parsePr(data: Record<string, any>, selfLogin?: string | null): PrInfo | null {
  if (!data || typeof data !== 'object' || !data.number || !data.url) return null;
  return {
    number: data.number,
    url: data.url,
    state: data.state,
    isDraft: data.isDraft === true,
    title: data.title,
    reviewDecision: data.reviewDecision ?? '',
    checks: summarizeChecks(data.statusCheckRollup),
    headSha: data.headRefOid,
    failingChecks: failingCheckNames(data.statusCheckRollup),
    commentSignature: commentSignature(data.comments, data.reviews, selfLogin),
    ...(typeof data.headRefName === 'string' && data.headRefName ? { headRefName: data.headRefName } : {}),
    ...(typeof data.baseRefName === 'string' && data.baseRefName ? { baseRefName: data.baseRefName } : {}),
  };
}

/** PR state for a branch; null when no PR exists. Any other gh failure
 *  (offline, auth, timeout) throws so the caller can keep its last good
 *  snapshot and flag it stale, rather than showing "no PR" for a branch
 *  that has one.
 *  When the branch has several PRs, gh picks one for us: open ones first,
 *  then newest created. Use prsForBranches to see them all.
 *  selfLogin (when known) excludes that user's own comments/reviews from the
 *  new-feedback signature — see commentSignature. */
export async function prStatus(repoPath: string, branch: string, selfLogin?: string | null): Promise<PrInfo | null> {
  let stdout: string;
  try {
    stdout = await gh(['pr', 'view', branch, '--json', PR_VIEW_FIELDS], repoPath);
  } catch (e) {
    if (isNoPrError(e)) return null;
    const err = e as { stderr?: string; message?: string };
    throw new Error(`gh pr view failed: ${err.stderr?.trim() || err.message || String(e)}`);
  }
  try {
    return parsePr(JSON.parse(stdout), selfLogin);
  } catch {
    return null;
  }
}

/** Every PR (open, merged, or closed) whose head is `branch`. Empty when
 *  none exist; throws on any gh failure, like prStatus. */
export async function prList(repoPath: string, branch: string, selfLogin?: string | null): Promise<PrInfo[]> {
  let stdout: string;
  try {
    stdout = await gh(['pr', 'list', '--head', branch, '--state', 'all', '--limit', String(PR_LIST_LIMIT), '--json', PR_VIEW_FIELDS], repoPath);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`gh pr list failed: ${err.stderr?.trim() || err.message || String(e)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map((item) => parsePr(item, selfLogin)).filter((pr): pr is PrInfo => pr !== null);
}

/** Order PRs primary-first: open before merged/closed, newest (highest
 *  number) first within each group. Mirrors how gh itself picks a PR for a
 *  branch, so the first entry is what `gh pr view <branch>` would show. */
export function sortPrs(prs: PrInfo[]): PrInfo[] {
  return [...prs].sort((a, b) => {
    const aOpen = a.state === 'OPEN' ? 0 : 1;
    const bOpen = b.state === 'OPEN' ? 0 : 1;
    return aOpen - bOpen || b.number - a.number;
  });
}

/** All PRs for a set of head branches (deduplicated by number), sorted with
 *  sortPrs. One gh call per branch, in sequence, so a session with a few
 *  branches doesn't fan out into parallel gh processes. */
export async function prsForBranches(repoPath: string, branches: string[], selfLogin?: string | null): Promise<PrInfo[]> {
  const byNumber = new Map<number, PrInfo>();
  for (const branch of [...new Set(branches.filter(Boolean))]) {
    for (const pr of await prList(repoPath, branch, selfLogin)) {
      if (!byNumber.has(pr.number)) byNumber.set(pr.number, pr);
    }
  }
  return sortPrs([...byNumber.values()]);
}

/** Inline review comments, submitted review bodies, and PR conversation comments,
 *  flattened for prompting. Conversation comments must be included: new-feedback
 *  detection (commentSignature) counts them, so an alert can fire for a plain PR
 *  comment with no review activity at all.
 *  Capped at the first 100 items per endpoint; the prompt tells the agent how to
 *  fetch the rest when more exist.
 *  gh substitutes {owner}/{repo} from the repo's origin remote. */
export async function prReviewComments(repoPath: string, prNumber: number): Promise<PrReviewComment[]> {
  const [inline, reviews, conversation] = await Promise.all([
    gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
    gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
    gh(['api', `repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
  ]);

  const result: PrReviewComment[] = [];
  if (Array.isArray(reviews)) {
    for (const r of reviews as Array<Record<string, any>>) {
      if (!r.body?.trim() || String(r.state).toUpperCase() === 'PENDING') continue;
      result.push({
        id: `review-${r.id}`,
        author: r.user?.login ?? 'unknown',
        authorAssociation: r.author_association ?? 'NONE',
        body: r.body,
      });
    }
  }
  if (Array.isArray(inline)) {
    for (const c of inline as Array<Record<string, any>>) {
      if (!c.body?.trim()) continue;
      result.push({
        id: `comment-${c.id}`,
        author: c.user?.login ?? 'unknown',
        authorAssociation: c.author_association ?? 'NONE',
        path: c.path,
        line: c.line ?? c.original_line ?? undefined,
        body: c.body,
      });
    }
  }
  if (Array.isArray(conversation)) {
    for (const c of conversation as Array<Record<string, any>>) {
      if (!c.body?.trim()) continue;
      result.push({
        id: `discussion-${c.id}`,
        author: c.user?.login ?? 'unknown',
        authorAssociation: c.author_association ?? 'NONE',
        body: c.body,
      });
    }
  }
  return result;
}

/** Create a PR for an already-pushed branch and return its full status. */
export async function prCreate(repoPath: string, branch: string, opts: PrCreateOpts): Promise<PrInfo> {
  const args = ['pr', 'create', '--head', branch, '--title', opts.title, '--body', opts.body];
  if (opts.base) args.push('--base', opts.base);
  if (opts.draft) args.push('--draft');
  try {
    await gh(args, repoPath);
  } catch (e: any) {
    throw new Error(e?.stderr?.trim() || e?.message || 'gh pr create failed');
  }
  let created: PrInfo | null;
  try {
    created = await prStatus(repoPath, branch);
  } catch (e: any) {
    throw new Error(`PR was created but could not be read back — check GitHub (${e?.message ?? e})`);
  }
  if (!created) throw new Error('PR was created but could not be read back — check GitHub');
  return created;
}
