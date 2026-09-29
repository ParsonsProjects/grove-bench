/**
 * Pure helpers behind the branch-operations dialog (rebase / cherry-pick /
 * squash between agent branches).
 */
import type { CommitEntry, GitOpResult, MergeIntoPlan } from '../../shared/types.js';

export interface BranchCandidate {
  branch: string;
  /** Sidebar label of the session on that branch, when it is one. */
  label: string;
  sessionId?: string;
}

interface SessionLike {
  id: string;
  branch: string;
  repoPath: string;
  displayName?: string | null;
}

/**
 * Branches worth offering as a rebase target or cherry-pick source: the
 * base branch first, then every other session in the same repo (one entry
 * per branch, the session's own branch excluded).
 */
export function candidateBranches(
  sessions: readonly SessionLike[],
  sessionId: string,
  baseBranch: string,
): BranchCandidate[] {
  const self = sessions.find((s) => s.id === sessionId);
  if (!self) return baseBranch ? [{ branch: baseBranch, label: 'base branch' }] : [];
  const out: BranchCandidate[] = [];
  const seen = new Set<string>([self.branch]);
  if (baseBranch && !seen.has(baseBranch)) {
    out.push({ branch: baseBranch, label: 'base branch' });
    seen.add(baseBranch);
  }
  for (const s of sessions) {
    if (s.id === sessionId || s.repoPath !== self.repoPath || seen.has(s.branch)) continue;
    seen.add(s.branch);
    out.push({ branch: s.branch, label: s.displayName || s.branch, sessionId: s.id });
  }
  return out;
}

/** Default squash message: the oldest commit's subject as the title, the
 *  rest (oldest first) as a bullet list. `commits` arrive newest first. */
export function squashMessageFrom(commits: readonly CommitEntry[]): string {
  if (commits.length === 0) return '';
  const oldestFirst = [...commits].reverse();
  const [first, ...rest] = oldestFirst;
  if (rest.length === 0) return first.subject;
  return `${first.subject}\n\n${rest.map((c) => `- ${c.subject}`).join('\n')}`;
}

/** One-line outcome text for the dialog. */
export function describeOpResult(result: GitOpResult, verb: string): { ok: boolean; text: string } {
  if (result.success) return { ok: true, text: `${verb} complete.` };
  if (result.conflicts && result.conflicts.length > 0) {
    const files = result.conflicts.slice(0, 8).join(', ');
    const more = result.conflicts.length > 8 ? ` and ${result.conflicts.length - 8} more` : '';
    return { ok: false, text: `${verb} aborted: conflicts in ${files}${more}. The branch is unchanged. Resolve in the terminal, or ask the agent to do it.` };
  }
  return { ok: false, text: `${verb} failed: ${result.error || 'unknown error'}` };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the merge dialog says will happen, from a plan with no `blocked`
 *  reason: the main line, and a note when some changes won't be included. */
export function describeMergePlan(plan: MergeIntoPlan): { summary: string; note?: string } {
  const what = `${plural(plan.commits, 'commit')} from ${plan.branch}`;
  const summary = plan.checkoutPath
    ? `${what} will be merged into ${plan.target} in your project folder. Nothing is pushed.`
    : `${what} will be added to ${plan.target}. No checkout has ${plan.target}, so it moves forward without touching any files. Nothing is pushed.`;
  if (plan.uncommitted === 0) return { summary };
  return {
    summary,
    note: `${plural(plan.uncommitted, 'file')} with uncommitted changes won't be included. Commit them first if you want them in ${plan.target}.`,
  };
}

/** Outcome text for the merge dialog. */
export function describeMergeResult(result: GitOpResult, target: string): { ok: boolean; text: string } {
  if (result.success) return { ok: true, text: `Merged into ${target}. Push ${target} when you're ready to share it.` };
  if (result.conflicts && result.conflicts.length > 0) {
    const files = result.conflicts.slice(0, 8).join(', ');
    const more = result.conflicts.length > 8 ? ` and ${result.conflicts.length - 8} more` : '';
    return {
      ok: false,
      text: `Merge stopped: ${target} and this branch both changed ${files}${more}. Nothing was changed. Ask the agent to rebase this branch onto ${target} and fix the conflicts, then merge again.`,
    };
  }
  return { ok: false, text: `Merge failed: ${result.error || 'unknown error'}` };
}
