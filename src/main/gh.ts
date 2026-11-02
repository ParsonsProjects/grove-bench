import { isReadOnly } from './process-host.js';
import { runInAgentHost } from './process-host-run.js';
import type { FailingRun, OpenPrSummary, PrChecksSummary, PrCreateOpts, PrInfo, PrMergeState, PrReviewComment, PrReviewer, PrReviewEvent } from '../shared/types.js';
import { isRecord } from './persisted-state.js';
import { ghRepoArg, parseActionsLink, parsePrUrl, parseRepoArg, sameRepo } from '../shared/github-links.js';
import { CI_RERUN_UNANSWERED, tailCiLog, type CiLogTail } from '../shared/ci-log.js';

/** obj.a.b... in JSON of unknown shape: undefined where a step isn't an
 *  object, as `?.` would give. */
function at(obj: unknown, ...path: string[]): unknown {
  let value = obj;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return value;
}

/** gh can sit forever on a stalled connection or an interactive prompt. The
 *  renderer polls PR status for every session in sequence, so one hung call
 *  would freeze the sweep for all of them; a bounded call fails instead and
 *  the next sweep retries. */
export const GH_TIMEOUT_MS = 30_000;

/**
 * Run gh. `input` goes to its stdin (for `gh api --input -`).
 *
 * In the agent host (runInAgentHost), not the git host with git: gh waits
 * on the network, and on Windows a timeout that kills gh alone can leave a
 * process it started holding the pipes, so the answer never comes. In the
 * git host that got the host restarted for not answering, which stopped
 * other threads' git work with it (23 Oct: a hung `gh pr` failed two
 * checkpoints). There, the timeout kills gh's whole tree and fails the call
 * as timed out, and nothing is restarted. gh is found on PATH as execa found
 * it (findCommand). Calls that only read (isReadOnly) run once more if the
 * agent host dies under them, as they did in the git host.
 */
export async function gh(args: string[], cwd?: string, input?: string, opts?: { timeout?: number; keepLastChars?: number }): Promise<string> {
  const result = await runInAgentHost('gh', args, {
    ...(cwd ? { cwd } : {}),
    timeout: opts?.timeout ?? GH_TIMEOUT_MS,
    findCommand: true,
    ...(input !== undefined ? { input } : {}),
    ...(isReadOnly('gh', args) ? { idempotent: true } : {}),
    ...(opts?.keepLastChars ? { keepLastChars: opts.keepLastChars } : {}),
  });
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

/** First back-off after GitHub rate-limits us. gh does not say when the limit
 *  resets, so each further hit doubles the wait, up to the max. Without it,
 *  the sweep keeps spending the same quota the agents' own gh calls need. */
export const GH_RATE_LIMIT_COOLDOWN_MS = 2 * 60_000;
export const GH_RATE_LIMIT_MAX_COOLDOWN_MS = 30 * 60_000;

/** Thrown while the rate-limit back-off holds. Short for the same reason as
 *  GH_OFFLINE_MESSAGE. */
export const GH_RATE_LIMITED_MESSAGE = 'GitHub rate limit reached, retrying later';

let rateLimitedUntil = 0;
/** Rate-limit hits in a row, for the doubling. A success resets it. */
let rateLimitStrikes = 0;

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

/** gh failing because GitHub rate-limited the account (primary or secondary
 *  limit). Only stderr is read when there is one: execa's message also holds
 *  the command line, and a PR title passed to `gh pr create` may well
 *  mention rate limits. */
export function isRateLimitError(e: unknown): boolean {
  const err = e as { stderr?: unknown; message?: unknown } | null;
  const text = typeof err?.stderr === 'string' ? err.stderr : typeof err?.message === 'string' ? err.message : '';
  // GH_RATE_LIMITED_MESSAGE matches too, so a short-circuited call still
  // reads as rate-limited once a caller has wrapped it in its own message.
  return /rate limit|HTTP 429/i.test(text);
}

/** True while a recent network failure's cooldown still holds. */
export function ghOffline(): boolean {
  return Date.now() < offlineUntil;
}

/** True while the back-off after a rate-limit hit still holds. */
export function ghRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export function resetGhOfflineCooldownForTests(): void {
  offlineUntil = 0;
  rateLimitedUntil = 0;
  rateLimitStrikes = 0;
}

/** gh for calls that need GitHub itself. Fails in microseconds while the
 *  cooldown holds instead of waiting out another timeout, and the first
 *  success reopens it, so recovery costs one call rather than a restart.
 *  bypassCooldown is for user-initiated calls: someone clicking a button has
 *  usually just noticed (and maybe fixed) the connection, so they always get
 *  a real attempt. */
async function ghOnline(args: string[], cwd?: string, opts?: { bypassCooldown?: boolean; input?: string }): Promise<string> {
  if (!opts?.bypassCooldown) {
    if (ghOffline()) throw new Error(GH_OFFLINE_MESSAGE);
    if (ghRateLimited()) throw new Error(GH_RATE_LIMITED_MESSAGE);
  }
  try {
    const out = await gh(args, cwd, opts?.input);
    offlineUntil = 0;
    rateLimitedUntil = 0;
    rateLimitStrikes = 0;
    return out;
  } catch (e) {
    if (isRateLimitError(e)) {
      rateLimitStrikes++;
      const wait = Math.min(GH_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitStrikes - 1), GH_RATE_LIMIT_MAX_COOLDOWN_MS);
      rateLimitedUntil = Date.now() + wait;
    } else if (isNetworkError(e)) {
      offlineUntil = Date.now() + GH_OFFLINE_COOLDOWN_MS;
    }
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
    const login = at(JSON.parse(await ghOnline(['api', 'user'])), 'login');
    if (typeof login === 'string' && login) cachedLogin = login;
  } catch {
    return null;
  }
  return cachedLogin;
}

export function resetGhLoginCacheForTests(): void {
  cachedLogin = null;
}

const PR_BASE_FIELDS = 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews,headRefName,baseRefName,author';
/** What the branch popup shows of merging and reviewing. Fields a gh too
 *  old to know them would refuse the whole call over ("Unknown JSON
 *  field"), so prFields drops them once one has. */
const PR_MERGE_FIELDS = 'mergeStateStatus,autoMergeRequest,reviewRequests';
let mergeFieldsUnknown = false;

function prFields(): string {
  return mergeFieldsUnknown ? PR_BASE_FIELDS : `${PR_BASE_FIELDS},${PR_MERGE_FIELDS}`;
}

/** Run a `gh pr view/list --json` call, once more without the merge fields
 *  if this gh doesn't know them. */
async function ghPrJson(args: string[], repoPath: string): Promise<string> {
  try {
    return await ghOnline([...args, '--json', prFields()], repoPath);
  } catch (e) {
    const stderr = (e as { stderr?: unknown } | null)?.stderr;
    if (mergeFieldsUnknown || typeof stderr !== 'string' || !/Unknown JSON field/i.test(stderr)) throw e;
    mergeFieldsUnknown = true;
    return ghOnline([...args, '--json', prFields()], repoPath);
  }
}

export function resetPrFieldsForTests(): void {
  mergeFieldsUnknown = false;
}
/** Upper bound on PRs read per head branch. A branch rarely has more than a
 *  handful (GitHub allows one open PR per head+base pair); the rest are history. */
const PR_LIST_LIMIT = 20;

const PASSED_VERDICTS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED_VERDICTS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function checkVerdict(item: Record<string, unknown>): string {
  return String(item.conclusion || item.state || '').toUpperCase();
}

type CheckRow = Record<string, unknown>;

/** Still queued or running: a check run whose status isn't COMPLETED, or a
 *  pending status. A completed run whose conclusion is neither a pass nor a
 *  failure (STALE, after 14 days unfinished) isn't. */
function inProgress(item: CheckRow): boolean {
  if (typeof item.status === 'string') return item.status.toUpperCase() !== 'COMPLETED';
  return checkVerdict(item) === 'PENDING';
}

/**
 * Each check in a statusCheckRollup array once: its newest attempt. gh
 * passes on every attempt of a job that was rerun, and every run of a
 * workflow started again on the same commit (marked ready for review,
 * reopened). Counting them all would keep a PR red after a rerun passed, or
 * after a cancelled run was followed by a passing one. gh's own `pr checks`
 * keeps the newest by start time per name, workflow and event; the JSON has
 * no event, so here a check is one name in one workflow (or one name, for
 * other apps' checks), and a status is one context. An attempt still in
 * progress is the newest: GitHub reruns only finished jobs, and gh gives a
 * queued one no start time. Rows with nothing to match them by are kept.
 */
export function latestChecks(rollup: unknown): CheckRow[] {
  if (!Array.isArray(rollup)) return [];
  const keyOf = (item: CheckRow): string | null => {
    if (typeof item.context === 'string' && item.context) return `status\0${item.context}`;
    if (typeof item.name !== 'string' || !item.name) return null;
    return `check\0${item.name}\0${typeof item.workflowName === 'string' ? item.workflowName : ''}`;
  };
  const newer = (a: CheckRow, b: CheckRow) =>
    inProgress(a) !== inProgress(b) ? inProgress(a) : String(a.startedAt ?? '') > String(b.startedAt ?? '');
  const kept: CheckRow[] = [];
  const slot = new Map<string, number>();
  for (const item of rollup.filter(isRecord)) {
    const key = keyOf(item);
    const index = key === null ? undefined : slot.get(key);
    if (index === undefined) {
      if (key !== null) slot.set(key, kept.length);
      kept.push(item);
    } else if (newer(item, kept[index])) {
      kept[index] = item;
    }
  }
  return kept;
}

/** Whole seconds from one of gh's times to another, if both are real:
 *  gh writes a time GitHub didn't give as 0001-01-01. */
function secondsBetween(from: unknown, to: unknown): number | undefined {
  const start = typeof from === 'string' ? Date.parse(from) : NaN;
  const end = typeof to === 'string' ? Date.parse(to) : NaN;
  if (!(start > 0) || !(end >= start)) return undefined;
  return Math.round((end - start) / 1000);
}

function checkName(item: CheckRow): string {
  return String(item.name || item.context || 'check');
}

/** Names of the failing checks in a statusCheckRollup array. */
export function failingCheckNames(rollup: unknown): string[] {
  return latestChecks(rollup).filter((item) => FAILED_VERDICTS.has(checkVerdict(item))).map(checkName);
}

/**
 * The failing checks (latestChecks'), split into the GitHub Actions runs
 * behind them, once each with their failed jobs, and the names of the rest.
 * Only check runs linking to an Actions run in the PR's own repository go
 * in runs: status contexts and other CI services' checks keep their logs
 * elsewhere, and a check from any app may link anywhere.
 */
function splitFailing(checks: CheckRow[], prUrl: string): { runs: FailingRun[]; others: string[] } {
  const pr = parsePrUrl(prUrl);
  const rows = checks.map((item) => {
    const link = pr ? parseActionsLink(typeof item.detailsUrl === 'string' ? item.detailsUrl : '') : null;
    return { item, link: link && pr && sameRepo(link, pr) ? link : null };
  });
  const runs: FailingRun[] = [];
  const others: string[] = [];
  for (const { item, link } of rows) {
    if (!FAILED_VERDICTS.has(checkVerdict(item))) continue;
    if (!link) {
      others.push(checkName(item));
      continue;
    }
    let run = runs.find((r) => r.runId === link.runId);
    if (!run) {
      const workflow = typeof item.workflowName === 'string' && item.workflowName ? item.workflowName : undefined;
      run = { repo: ghRepoArg(link), runId: link.runId, ...(workflow ? { workflow } : {}), jobs: [] };
      runs.push(run);
    }
    const { jobId } = link;
    const name = typeof item.name === 'string' && item.name ? item.name : jobId ? `job ${jobId}` : 'job';
    if (jobId ? !run.jobs.some((j) => j.id === jobId) : !run.jobs.some((j) => !j.id && j.name === name)) {
      const seconds = secondsBetween(item.startedAt, item.completedAt);
      run.jobs.push({ ...(jobId ? { id: jobId } : {}), name, ...(seconds !== undefined ? { seconds } : {}) });
    }
  }
  // A check of the same run still queued or running.
  for (const { item, link } of rows) {
    if (!link || !inProgress(item)) continue;
    const run = runs.find((r) => r.runId === link.runId);
    if (run) run.pending = true;
  }
  return { runs, others };
}

/** The GitHub Actions runs behind the failing checks in a statusCheckRollup
 *  array (see splitFailing). */
export function failingActionsRuns(rollup: unknown, prUrl: string): FailingRun[] {
  return splitFailing(latestChecks(rollup), prUrl).runs;
}

/** Opaque ids for conversation comments + submitted reviews, for new-feedback detection.
 *  ignoreLogin drops entries authored by that user (the gh-authenticated account):
 *  the agent replying on the PR must not read as new feedback, or auto
 *  address-reviews mode would answer its own replies in a loop. */
export function commentSignature(comments: unknown, reviews: unknown, ignoreLogin?: string | null): string[] {
  const sig: string[] = [];
  if (Array.isArray(comments)) {
    for (const c of comments as unknown[]) {
      const author = at(c, 'author', 'login');
      if (ignoreLogin && author === ignoreLogin) continue;
      sig.push(`c:${String(at(c, 'id') ?? `${author}@${at(c, 'createdAt')}`)}`);
    }
  }
  if (Array.isArray(reviews)) {
    for (const r of reviews as unknown[]) {
      if (String(at(r, 'state')).toUpperCase() === 'PENDING') continue;
      const author = at(r, 'author', 'login');
      if (ignoreLogin && author === ignoreLogin) continue;
      sig.push(`r:${String(at(r, 'id') ?? `${author}@${at(r, 'submittedAt')}`)}`);
    }
  }
  return sig;
}

/** Fold gh's statusCheckRollup array into pass/fail/pending counts. */
export function summarizeChecks(rollup: unknown): PrChecksSummary | null {
  return summarize(latestChecks(rollup));
}

function summarize(checks: CheckRow[]): PrChecksSummary | null {
  if (checks.length === 0) return null;
  const summary: PrChecksSummary = { total: checks.length, passed: 0, failed: 0, pending: 0 };
  for (const item of checks) {
    // CheckRun rows carry status/conclusion; StatusContext rows carry state.
    const verdict = String(item.conclusion || item.state || '').toUpperCase();
    if (PASSED_VERDICTS.has(verdict)) summary.passed++;
    else if (FAILED_VERDICTS.has(verdict)) summary.failed++;
    else summary.pending++;
  }
  return summary;
}

/** The fields of gh's PR JSON (prFields) that parsePr reads. gh's own
 *  output, so trusted to have these types where they are there at all. */
interface GhPrJson {
  number?: number;
  url?: string;
  state?: PrInfo['state'];
  isDraft?: boolean;
  title?: string;
  reviewDecision?: string;
  headRefOid?: string;
  headRefName?: string;
  baseRefName?: string;
  statusCheckRollup?: unknown;
  comments?: unknown;
  reviews?: unknown;
  author?: { login?: string };
  mergeStateStatus?: string;
  autoMergeRequest?: unknown;
  reviewRequests?: unknown;
}

const MERGE_STATES = new Set<PrMergeState>(['clean', 'behind', 'blocked', 'dirty', 'unstable', 'has_hooks', 'draft', 'unknown']);

function mergeStateOf(status: unknown): PrMergeState | undefined {
  const state = typeof status === 'string' ? status.toLowerCase() : '';
  return MERGE_STATES.has(state as PrMergeState) ? (state as PrMergeState) : undefined;
}

/**
 * Each reviewer's standing review, from all the PR's reviews in order: their
 * last approval or request for changes (a dismissed one no longer counts),
 * else that they commented. A comment after a request for changes doesn't
 * take it back, as GitHub's reviewDecision doesn't. The PR's author and the
 * gh account are left out: the agent answers reviews as the gh account,
 * which reads as a comment review, as commentSignature also allows for.
 */
function reviewersOf(reviews: unknown, leaveOut: (string | null | undefined)[]): PrReviewer[] {
  if (!Array.isArray(reviews)) return [];
  const skip = new Set(leaveOut.filter((login): login is string => !!login));
  const byLogin = new Map<string, { opinion?: 'approved' | 'changes_requested'; commented?: boolean }>();
  for (const review of reviews) {
    const login = at(review, 'author', 'login');
    if (typeof login !== 'string' || !login || skip.has(login)) continue;
    const entry = byLogin.get(login) ?? {};
    const state = String(at(review, 'state') ?? '').toUpperCase();
    if (state === 'APPROVED') entry.opinion = 'approved';
    else if (state === 'CHANGES_REQUESTED') entry.opinion = 'changes_requested';
    else if (state === 'DISMISSED') entry.opinion = undefined;
    else if (state === 'COMMENTED') entry.commented = true;
    else continue;
    byLogin.set(login, entry);
  }
  const reviewers: PrReviewer[] = [];
  for (const [login, entry] of byLogin) {
    const state = entry.opinion ?? (entry.commented ? 'commented' : undefined);
    if (state) reviewers.push({ login, state });
  }
  return reviewers;
}

/** Whom a review is asked of (reviewRequests): a user's login, a team's name. */
function requestedReviewersOf(reviewRequests: unknown): string[] {
  if (!Array.isArray(reviewRequests)) return [];
  return reviewRequests
    .map((request) => at(request, 'login') ?? at(request, 'name') ?? at(request, 'slug'))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/** Shape one gh PR JSON object into PrInfo; null when it isn't a PR. */
function parsePr(json: unknown, selfLogin?: string | null): PrInfo | null {
  if (!isRecord(json)) return null;
  const data = json as GhPrJson;
  if (!data.number || !data.url) return null;
  // Each check once, worked out once for all three.
  const checks = latestChecks(data.statusCheckRollup);
  const { runs: failingRuns, others: otherFailingChecks } = splitFailing(checks, data.url);
  // The checks summarize counts as pending: neither passed nor failed.
  const runningChecks = checks.filter((item) => { const v = checkVerdict(item); return !PASSED_VERDICTS.has(v) && !FAILED_VERDICTS.has(v); }).map(checkName);
  const mergeState = mergeStateOf(data.mergeStateStatus);
  const reviewers = reviewersOf(data.reviews, [data.author?.login, selfLogin]);
  const requestedReviewers = requestedReviewersOf(data.reviewRequests);
  return {
    number: data.number,
    url: data.url,
    state: data.state,
    isDraft: data.isDraft === true,
    title: data.title,
    reviewDecision: data.reviewDecision ?? '',
    checks: summarize(checks),
    headSha: data.headRefOid,
    failingChecks: checks.filter((item) => FAILED_VERDICTS.has(checkVerdict(item))).map(checkName),
    ...(failingRuns.length > 0 ? { failingRuns } : {}),
    ...(failingRuns.length > 0 && otherFailingChecks.length > 0 ? { otherFailingChecks } : {}),
    commentSignature: commentSignature(data.comments, data.reviews, selfLogin),
    ...(typeof data.headRefName === 'string' && data.headRefName ? { headRefName: data.headRefName } : {}),
    ...(typeof data.baseRefName === 'string' && data.baseRefName ? { baseRefName: data.baseRefName } : {}),
    // Only when both logins are known: an unknown answer must not hide the
    // review options for a PR someone else opened.
    ...(selfLogin && typeof data.author?.login === 'string' ? { viewerIsAuthor: data.author.login === selfLogin } : {}),
    ...(mergeState ? { mergeState } : {}),
    ...(isRecord(data.autoMergeRequest) ? { autoMerge: true } : {}),
    ...(reviewers.length > 0 ? { reviewers } : {}),
    ...(requestedReviewers.length > 0 ? { requestedReviewers } : {}),
    ...(runningChecks.length > 0 ? { runningChecks } : {}),
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
    stdout = await ghPrJson(['pr', 'view', branch], repoPath);
  } catch (e) {
    if (isNoPrError(e)) return null;
    const err = e as { stderr?: string; message?: string };
    throw new Error(`gh pr view failed: ${err.stderr?.trim() || err.message || String(e)}`, { cause: e });
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
    stdout = await ghPrJson(['pr', 'list', '--head', branch, '--state', 'all', '--limit', String(PR_LIST_LIMIT)], repoPath);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`gh pr list failed: ${err.stderr?.trim() || err.message || String(e)}`, { cause: e });
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

const OPEN_PR_FIELDS = 'number,title,headRefName,author,isDraft,isCrossRepository,url';
const OPEN_PR_LIMIT = 50;

/** Parse `gh pr list --json OPEN_PR_FIELDS` output, skipping malformed entries. */
export function parseOpenPrs(stdout: string): OpenPrSummary[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const result: OpenPrSummary[] = [];
  for (const item of data as unknown[]) {
    if (!isRecord(item) || typeof item.number !== 'number' || typeof item.headRefName !== 'string' || !item.headRefName) continue;
    const author = at(item, 'author', 'login');
    result.push({
      number: item.number,
      title: typeof item.title === 'string' ? item.title : '',
      headRefName: item.headRefName,
      author: typeof author === 'string' ? author : '',
      isDraft: item.isDraft === true,
      isCrossRepository: item.isCrossRepository === true,
      url: typeof item.url === 'string' ? item.url : '',
    });
  }
  return result;
}

/** Open PRs in the repo, newest first (gh's default order). Throws on any gh
 *  failure. Called when someone opens the picker, so it skips the offline
 *  cooldown like other user-initiated calls. */
export async function openPrs(repoPath: string): Promise<OpenPrSummary[]> {
  const stdout = await ghOnline(
    ['pr', 'list', '--state', 'open', '--limit', String(OPEN_PR_LIMIT), '--json', OPEN_PR_FIELDS],
    repoPath,
    { bypassCooldown: true },
  );
  return parseOpenPrs(stdout);
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

/** The fields of a GitHub REST review, review comment or issue comment that
 *  prReviewComments reads. GitHub's own JSON, so trusted to have these types. */
interface GhApiComment {
  id?: number;
  body?: string | null;
  state?: string;
  user?: { login?: string } | null;
  author_association?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

/** Inline review comments, submitted review bodies, and PR conversation comments,
 *  flattened for prompting. Conversation comments must be included: new-feedback
 *  detection (commentSignature) counts them, so an alert can fire for a plain PR
 *  comment with no review activity at all.
 *  Capped at the first 100 items per endpoint; the prompt tells the agent how to
 *  fetch the rest when more exist.
 *  gh substitutes {owner}/{repo} from the repo's origin remote. */
export async function prReviewComments(repoPath: string, prNumber: number): Promise<PrReviewComment[]> {
  const fetchList = (endpoint: string) => ghOnline(['api', `repos/{owner}/{repo}/${endpoint}?per_page=100`], repoPath)
    .then((s): unknown => JSON.parse(s)).catch(() => []);
  const [inline, reviews, conversation] = await Promise.all([
    fetchList(`pulls/${prNumber}/comments`),
    fetchList(`pulls/${prNumber}/reviews`),
    fetchList(`issues/${prNumber}/comments`),
  ]);

  const result: PrReviewComment[] = [];
  if (Array.isArray(reviews)) {
    for (const r of reviews as GhApiComment[]) {
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
    for (const c of inline as GhApiComment[]) {
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
    for (const c of conversation as GhApiComment[]) {
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
  } catch (e) {
    const err = e as { stderr?: string; message?: string } | null;
    throw new Error(err?.stderr?.trim() || err?.message || 'gh pr create failed', { cause: e });
  }
  let created: PrInfo | null;
  try {
    created = await prStatus(repoPath, branch);
  } catch (e) {
    const message = (e as { message?: string } | null)?.message;
    throw new Error(`PR was created but could not be read back — check GitHub (${message ?? e})`, { cause: e });
  }
  if (!created) throw new Error('PR was created but could not be read back — check GitHub');
  // Opened with the gh account just now, so it's the viewer's own.
  return { ...created, viewerIsAuthor: true };
}

/** A readable reason from a failed `gh api` call. gh prints GitHub's JSON
 *  error to stdout, and its `errors` list says what was wrong (for example
 *  "Can not approve your own pull request"); stderr only has the status. */
export function ghApiErrorMessage(e: unknown): string {
  const err = e as { stdout?: unknown; stderr?: unknown; message?: unknown } | null;
  if (typeof err?.stdout === 'string' && err.stdout.trim()) {
    try {
      const data = JSON.parse(err.stdout) as { message?: unknown; errors?: unknown };
      const details = Array.isArray(data.errors)
        ? data.errors
          .map((x: unknown) => {
            const message = at(x, 'message');
            return typeof x === 'string' ? x : typeof message === 'string' ? message : '';
          })
          .filter(Boolean)
        : [];
      if (details.length > 0) return details.join('; ');
      if (typeof data.message === 'string' && data.message) return data.message;
    } catch { /* not JSON: fall through */ }
  }
  if (typeof err?.stderr === 'string' && err.stderr.trim()) return err.stderr.trim();
  return typeof err?.message === 'string' && err.message ? err.message : String(e);
}

/** A job's log can take a while to download. */
export const GH_LOG_TIMEOUT_MS = 60_000;
/** The end of a job's log kept to cut the shown part from: well past it. */
const JOB_LOG_KEEP_CHARS = 2 * 1024 * 1024;
/** Asking for a rerun is quick, but GitHub can be slow to answer. */
export const GH_RERUN_TIMEOUT_MS = 60_000;

/** The HTTP status in gh's error, if any: `gh api` says "Not Found (HTTP
 *  404)", other commands "HTTP 403: Must have admin rights". */
function ghHttpStatus(e: unknown): number | null {
  const stderr = (e as { stderr?: unknown } | null)?.stderr;
  const m = typeof stderr === 'string' ? /\bHTTP (\d{3})\b/.exec(stderr) : null;
  return m ? Number(m[1]) : null;
}

/**
 * The readable end of a failed Actions job's log. Through the jobs API,
 * which has it as soon as that job ends: `gh run view --log-failed` waits
 * for the whole run, `--job` or not. Asked for by the user, so it doesn't
 * wait out the offline cooldown; and called through gh() rather than
 * ghOnline, so a slow download doesn't start one (timeouts read as
 * GitHub being unreachable, which would pause every thread's PR polling).
 */
export async function prJobLog(cwd: string, repo: string, jobId: string): Promise<CiLogTail> {
  const ref = parseRepoArg(repo);
  if (!ref || !/^\d{1,20}$/.test(jobId)) throw new Error('Not a GitHub Actions job');
  try {
    const raw = await gh(
      // The host always: with GH_HOST set, gh api would send it there.
      ['api', '--hostname', ref.host, `repos/${ref.owner}/${ref.name}/actions/jobs/${jobId}/logs`],
      cwd,
      undefined,
      { timeout: GH_LOG_TIMEOUT_MS, keepLastChars: JOB_LOG_KEEP_CHARS },
    );
    return tailCiLog(raw);
  } catch (e) {
    if ((e as { timedOut?: unknown } | null)?.timedOut === true) {
      throw new Error('GitHub took too long to send the log. Try again, or open the check on GitHub.', { cause: e });
    }
    if (isRateLimitError(e)) throw new Error(GH_API_LIMIT_MESSAGE, { cause: e });
    const status = ghHttpStatus(e);
    if (status === 404 || status === 410) {
      throw new Error('GitHub has no log for this job. It may have expired (logs are kept for 90 days unless the repository says otherwise), or this gh account can\'t see the repository.', { cause: e });
    }
    if (status === 403) throw new Error(`GitHub refused to send the log: ${ghReason(e)}`, { cause: e });
    throw new Error(ghReason(e), { cause: e });
  }
}

/** Rerun a run's failed jobs, and the jobs that depend on them. GitHub
 *  refuses while any job of the run is still going. */
export async function prRerunFailed(cwd: string, repo: string, runId: string): Promise<void> {
  const ref = parseRepoArg(repo);
  if (!ref || !/^\d{1,20}$/.test(runId)) throw new Error('Not a GitHub Actions run');
  try {
    // HOST/OWNER/REPO always: with GH_HOST set, OWNER/REPO would mean there.
    await gh(['run', 'rerun', runId, '--failed', '--repo', `${ref.host}/${ref.owner}/${ref.name}`], cwd, undefined, { timeout: GH_RERUN_TIMEOUT_MS });
  } catch (e) {
    if ((e as { timedOut?: unknown } | null)?.timedOut === true) throw new Error(CI_RERUN_UNANSWERED, { cause: e });
    if (isRateLimitError(e)) throw new Error(GH_API_LIMIT_MESSAGE, { cause: e });
    if (ghHttpStatus(e) === 403) throw new Error(`GitHub refused the rerun: ${ghReason(e)}`, { cause: e });
    throw new Error(ghReason(e), { cause: e });
  }
}

/** For a call the user asked for, when GitHub's rate limit stopped it. */
const GH_API_LIMIT_MESSAGE = 'GitHub\'s API rate limit is reached for this gh account. Try again in a few minutes.';

/** GitHub's reason for a failed call, without gh's wrapping: "failed to
 *  rerun: HTTP 403: Must have admin rights to Repository. (https://...)"
 *  reads "HTTP 403: Must have admin rights to Repository.", and "gh: Not
 *  Found (HTTP 404)" reads "Not Found (HTTP 404)". */
function ghReason(e: unknown): string {
  return ghApiErrorMessage(e).replace(/^gh: /, '').replace(/^failed to [^:]*: /, '').replace(/\s*\(https?:\/\/[^)]*\)\s*$/, '');
}

/** The PR's head commit, read fresh. Throws a readable error. */
export async function prHeadSha(repoPath: string, prNumber: number): Promise<string> {
  let stdout: string;
  try {
    stdout = await ghOnline(['pr', 'view', String(prNumber), '--json', 'headRefOid'], repoPath, { bypassCooldown: true });
  } catch (e) {
    throw new Error(`Could not read PR #${prNumber}: ${ghApiErrorMessage(e)}`, { cause: e });
  }
  const sha = (JSON.parse(stdout) as { headRefOid?: unknown }).headRefOid;
  if (typeof sha !== 'string' || !sha) throw new Error(`Could not read PR #${prNumber}`);
  return sha;
}

/** GitHub lists at most 3000 files for a PR, 100 per page. */
const PR_FILES_PER_PAGE = 100;
const PR_FILES_MAX_PAGES = 30;

/** Each changed file's patch in the PR, by path. A file GitHub sends no patch
 *  for (binary, or too large) maps to null. Pages are read one gh call at a
 *  time rather than with --paginate, whose output for arrays isn't one JSON
 *  document. */
export async function prFilePatches(repoPath: string, prNumber: number): Promise<Map<string, string | null>> {
  const patches = new Map<string, string | null>();
  for (let page = 1; page <= PR_FILES_MAX_PAGES; page++) {
    let stdout: string;
    try {
      stdout = await ghOnline(
        ['api', `repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`],
        repoPath,
        { bypassCooldown: true },
      );
    } catch (e) {
      throw new Error(`Could not read PR #${prNumber}'s files: ${ghApiErrorMessage(e)}`, { cause: e });
    }
    const data = JSON.parse(stdout) as unknown;
    if (!Array.isArray(data)) break;
    for (const f of data as Array<Record<string, unknown>>) {
      if (typeof f.filename !== 'string') continue;
      patches.set(f.filename, typeof f.patch === 'string' ? f.patch : null);
    }
    if (data.length < PR_FILES_PER_PAGE) break;
  }
  return patches;
}

/** One inline comment in GitHub's review payload: `line` is the last line,
 *  and a range adds `start_line`. */
export interface GhReviewComment {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

/** Submit a review on a PR in one call, inline comments included. Pinned to
 *  `commitId` when given, so comments land on the lines that were checked
 *  against it. Returns the review's page on GitHub. */
export async function prSubmitReview(
  repoPath: string,
  prNumber: number,
  review: { event: PrReviewEvent; body: string; commitId?: string; comments: GhReviewComment[] },
): Promise<{ url: string | null }> {
  const payload = {
    event: review.event,
    ...(review.body ? { body: review.body } : {}),
    ...(review.commitId ? { commit_id: review.commitId } : {}),
    ...(review.comments.length > 0 ? { comments: review.comments } : {}),
  };
  let stdout: string;
  try {
    stdout = await ghOnline(
      ['api', '-X', 'POST', `repos/{owner}/{repo}/pulls/${prNumber}/reviews`, '--input', '-'],
      repoPath,
      { bypassCooldown: true, input: JSON.stringify(payload) },
    );
  } catch (e) {
    // A post that timed out may still have reached GitHub. Posting again
    // would add a second review, so say to look first.
    if ((e as { timedOut?: unknown } | null)?.timedOut === true) {
      throw new Error('GitHub didn\'t answer in time. The review may still have been posted, so check the PR before submitting again.', { cause: e });
    }
    throw new Error(ghApiErrorMessage(e), { cause: e });
  }
  try {
    const url = (JSON.parse(stdout) as { html_url?: unknown }).html_url;
    return { url: typeof url === 'string' ? url : null };
  } catch {
    return { url: null };
  }
}
