import type { PrInfo } from '../../shared/types.js';

/** Per-session detection state for PR watching. Mutated by detectPrEvents. */
export interface PrWatchState {
  /** First poll seeds the baseline silently — no alerts for pre-existing feedback. */
  seeded: boolean;
  /** Head SHA we last alerted a CI failure for (one alert per pushed commit). */
  alertedFailureSha?: string;
  /** Comment/review ids already seen. */
  seenComments: Set<string>;
}

export function newPrWatchState(): PrWatchState {
  return { seeded: false, seenComments: new Set() };
}

export type PrWatchEvent =
  | { kind: 'ci_failed'; checks: string[] }
  | { kind: 'new_comments'; count: number };

/**
 * Diff a fresh PR snapshot against the watch state, returning newly-detected
 * events and updating the state. Only open PRs produce events.
 */
export function detectPrEvents(state: PrWatchState, pr: PrInfo | null): PrWatchEvent[] {
  if (!pr || pr.state !== 'OPEN') return [];

  const sig = pr.commentSignature ?? [];
  const failed = (pr.checks?.failed ?? 0) > 0;

  if (!state.seeded) {
    state.seeded = true;
    for (const id of sig) state.seenComments.add(id);
    // A failure that predates the app session isn't "news" — badge shows it anyway.
    if (failed && pr.headSha) state.alertedFailureSha = pr.headSha;
    return [];
  }

  const events: PrWatchEvent[] = [];

  if (failed && pr.headSha && state.alertedFailureSha !== pr.headSha) {
    state.alertedFailureSha = pr.headSha;
    events.push({ kind: 'ci_failed', checks: pr.failingChecks ?? [] });
  }
  // Checks recovered on this SHA → allow alerting again if they fail later on it
  if (!failed && (pr.checks?.pending ?? 0) === 0 && state.alertedFailureSha === pr.headSha) {
    state.alertedFailureSha = undefined;
  }

  const fresh = sig.filter((id) => !state.seenComments.has(id));
  if (fresh.length > 0) {
    for (const id of fresh) state.seenComments.add(id);
    events.push({ kind: 'new_comments', count: fresh.length });
  }

  return events;
}

/** Author associations trusted for automatic (unattended) review handling. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function isTrustedAssociation(association: string): boolean {
  return TRUSTED_ASSOCIATIONS.has(association.toUpperCase());
}
