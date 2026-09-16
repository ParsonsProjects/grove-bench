/**
 * Pure helpers behind the branch-operations dialog (rebase / cherry-pick /
 * squash between agent branches).
 */
import type { CommitEntry, GitOpResult } from '../../shared/types.js';

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
