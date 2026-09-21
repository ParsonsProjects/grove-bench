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

/** How long GitHub is treated as unreachable after a call fails for network
 *  reasons. Without it, an offline machine pays GH_TIMEOUT_MS per branch per
 *  session on every sweep: a handful of sessions is minutes of hung gh
 *  processes for a connection already known to be down. */
export const GH_OFFLINE_COOLDOWN_MS = 60_000;

/** Thrown while the cooldown holds. Deliberately short: Electron logs the
 *  text of every rejected IPC handler, so a full gh command echo per session
 *  per sweep is what fills the log when the network drops. */
export const GH_OFFLINE_MESSAGE = 'GitHub is unreachable, retrying shortly';

let offlineUntil = 0;

/** gh failing because it could not reach GitHub (DNS, connection, TLS, or our
 *  own timeout), as opposed to an auth, no-PR, or bad-argument failure. Only
 *  the former is worth backing off from; the rest stay broken until something
 *  changes, so they must not trip the cooldown. */
export function isNetworkError(e: unknown): boolean {
  const err = e as { stderr?: unknown; message?: unknown; code?: unknown; timedOut?: unknown } | null;
  if (err?.timedOut === true) return true;
  const parts = [err?.stderr, err?.message, err?.code].filter((v) => typeof v === 'string');
  // GH_OFFLINE_MESSAGE is in the list so a short-circuited call still reads as
  // a network failure once a caller has wrapped it in its own message.
  return /error connecting to|timed out|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|dial tcp|connection refused|TLS handshake|network is unreachable|GitHub is unreachable/i.test(parts.join('\n'));
}

/** True while a recent network failure's cooldown still holds. */
export function ghOffline(): boolean {
  return Date.now() < offlineUntil;
}

export function resetGhOfflineCooldownForTests(): void {
  offlineUntil = 0;
}

/** gh for calls that need GitHub itself. Fails in microseconds while the
 *  cooldown holds instead of waiting out another timeout, and the first
 *  success reopens it, so recovery costs one call rather than a restart.
 *  bypassCooldown is for user-initiated calls: someone clicking a button has
 *  usually just noticed (and maybe fixed) the connection, so they always get
 *  a real attempt. */
async function ghOnline(args: string[], cwd?: string, opts?: { bypassCooldown?: boolean }): Promise<string> {
  if (!opts?.bypassCooldown && ghOffline()) throw new Error(GH_OFFLINE_MESSAGE);
  try {
    const out = await gh(args, cwd);
    offlineUntil = 0;
    return out;
  } catch (e) {
    if (isNetworkError(e)) offlineUntil = Date.now() + GH_OFFLINE_COOLDOWN_MS;
    throw e;
  }
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
    const login = JSON.parse(await ghOnline(['api', 'user']))?.login;
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
    stdout = await ghOnline(['pr', 'view', branch, '--json', PR_VIEW_FIELDS], repoPath);
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
    stdout = await ghOnline(['pr', 'list', '--head', branch, '--state', 'all', '--limit', String(PR_LIST_LIMIT), '--json', PR_VIEW_FIELDS], repoPath);
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
    ghOnline(['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
    ghOnline(['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
    ghOnline(['api', `repos/{owner}/{repo}/issues/${prNumber}/comments?per_page=100`], repoPath)
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
    await ghOnline(args, repoPath, { bypassCooldown: true });
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
