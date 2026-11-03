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
