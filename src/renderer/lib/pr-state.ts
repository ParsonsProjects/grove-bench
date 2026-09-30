import type { PrInfo } from '../../shared/types.js';

export type PrStateKind = 'merged' | 'closed' | 'draft' | 'open';

export interface PrStateFlag {
  kind: PrStateKind;
  /** Short user-facing word, e.g. "merged". */
  label: string;
  /** Tailwind text colour class matching the status bar's PR colours. */
  colorClass: string;
}

/** Collapse a PrInfo into the one state the user cares about when deciding
 *  whether a conversation is finished with. gh reports state (OPEN, MERGED,
 *  CLOSED) and draft separately; a draft is only meaningful while open. */
export function prStateFlag(pr: PrInfo): PrStateFlag {
  if (pr.state === 'MERGED') return { kind: 'merged', label: 'merged', colorClass: 'text-purple-400' };
  if (pr.state === 'CLOSED') return { kind: 'closed', label: 'closed', colorClass: 'text-red-400' };
  if (pr.isDraft) return { kind: 'draft', label: 'draft', colorClass: 'text-muted-foreground' };
  return { kind: 'open', label: 'open', colorClass: 'text-blue-400' };
}

/** True when the PR has been merged, so the branch's work has landed and the
 *  conversation (and usually its branch) can be removed safely. */
export function isPrMerged(pr: PrInfo | null | undefined): boolean {
  return pr?.state === 'MERGED';
}

export type PrHealthKind = 'none' | 'open' | 'merged' | 'closed' | 'failing' | 'changes-requested' | 'pending' | 'passing';

export interface PrHealth {
  kind: PrHealthKind;
  /** Short user-facing description, e.g. "CI failing". */
  label: string;
  /** Tailwind background class, for the status bar's PR dot. */
  bgClass: string;
  /** Tailwind text colour class, for icons drawn with currentColor. */
  textClass: string;
}

/** The worst condition on a branch's PR, as one colour. Merged and closed
 *  win over checks; failing CI beats a changes-requested review, which beats
 *  pending checks. An open PR with no checks and no review stays neutral. */
export function prHealth(pr: PrInfo | null | undefined): PrHealth {
  if (!pr) return { kind: 'none', label: 'No pull request', bgClass: 'bg-muted-foreground/40', textClass: 'text-muted-foreground' };
  if (pr.state === 'MERGED') return { kind: 'merged', label: 'Merged', bgClass: 'bg-purple-400', textClass: 'text-purple-400' };
  if (pr.state === 'CLOSED') return { kind: 'closed', label: 'Closed', bgClass: 'bg-red-500', textClass: 'text-red-500' };
  if ((pr.checks?.failed ?? 0) > 0) return { kind: 'failing', label: 'CI failing', bgClass: 'bg-red-500', textClass: 'text-red-500' };
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { kind: 'changes-requested', label: 'Changes requested', bgClass: 'bg-orange-400', textClass: 'text-orange-400' };
  if ((pr.checks?.pending ?? 0) > 0) return { kind: 'pending', label: 'Checks pending', bgClass: 'bg-yellow-400', textClass: 'text-yellow-400' };
  if (pr.reviewDecision === 'APPROVED') return { kind: 'passing', label: 'Approved', bgClass: 'bg-green-500', textClass: 'text-green-500' };
  if (pr.checks) return { kind: 'passing', label: 'Checks passing', bgClass: 'bg-green-500', textClass: 'text-green-500' };
  return { kind: 'open', label: 'Open', bgClass: 'bg-muted-foreground/40', textClass: 'text-muted-foreground' };
}
