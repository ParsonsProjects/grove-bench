import { execa } from 'execa';
import type { PrChecksSummary, PrCreateOpts, PrInfo, PrReviewComment } from '../shared/types.js';

export async function gh(args: string[], cwd?: string): Promise<string> {
  const result = await execa('gh', args, cwd ? { cwd } : {});
  return result.stdout;
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

const PR_VIEW_FIELDS = 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews';

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

/** Opaque ids for conversation comments + submitted reviews, for new-feedback detection. */
export function commentSignature(comments: unknown, reviews: unknown): string[] {
  const sig: string[] = [];
  if (Array.isArray(comments)) {
    for (const c of comments as Array<Record<string, any>>) {
      sig.push(`c:${c.id ?? `${c.author?.login}@${c.createdAt}`}`);
    }
  }
  if (Array.isArray(reviews)) {
    for (const r of reviews as Array<Record<string, any>>) {
      if (String(r.state).toUpperCase() === 'PENDING') continue;
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

/** PR state for a branch; null when no PR exists or gh is unavailable. */
export async function prStatus(repoPath: string, branch: string): Promise<PrInfo | null> {
  try {
    const stdout = await gh(['pr', 'view', branch, '--json', PR_VIEW_FIELDS], repoPath);
    const data = JSON.parse(stdout);
    if (!data.number || !data.url) return null;
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
      commentSignature: commentSignature(data.comments, data.reviews),
    };
  } catch {
    return null;
  }
}

/** Inline review comments + submitted review bodies for a PR, flattened for prompting.
 *  gh substitutes {owner}/{repo} from the repo's origin remote. */
export async function prReviewComments(repoPath: string, prNumber: number): Promise<PrReviewComment[]> {
  const [inline, reviews] = await Promise.all([
    gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments?per_page=100`], repoPath)
      .then((s) => JSON.parse(s)).catch(() => []),
    gh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`], repoPath)
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
  const created = await prStatus(repoPath, branch);
  if (!created) throw new Error('PR was created but could not be read back — check GitHub');
  return created;
}
