import type { PrInfo, GitSyncStatus, PrCreateOpts } from '../../shared/types.js';
import { messageStore } from './messages.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { buildFixCiPrompt, buildAddressReviewsPrompt } from '../lib/pr-prompt.js';
import { notifyOs } from '../lib/os-notify.js';
import { detectPrEvents, newPrWatchState, isTrustedAssociation } from '../lib/pr-watch.js';
import type { PrWatchState, PrWatchEvent } from '../lib/pr-watch.js';

const POLL_MS = 60_000;
const THROTTLE_MS = 5_000;
/** The sweep stops waiting on one session's fetch after this long and moves
 *  on. The main-side gh call has its own (shorter) timeout; this is the
 *  backstop so a stuck IPC round-trip can never freeze polling for every
 *  other session. A late result still lands when it eventually resolves. */
const SWEEP_REFRESH_TIMEOUT_MS = 45_000;
/** Auto-fix gives up on a head commit after this many attempts and asks for a human. */
const MAX_AUTO_FIX_ATTEMPTS = 2;

const EMPTY_SYNC: GitSyncStatus = { upstream: null, ahead: 0, behind: 0 };

type PrAlertInput =
  | { kind: 'ci_failed'; checks: string[] }
  | { kind: 'new_comments'; count: number }
  | { kind: 'needs_human'; reason: string };

/** Alerts belong to the PR they were raised for, so switching the primary
 *  PR hides the other PR's alerts rather than mislabelling them. */
export type PrAlert = PrAlertInput & { id: number; prNumber: number };

export interface PrAutoConfig {
  fixCi: boolean;
  addressReviews: boolean;
}

/** PR + branch-sync state per session. Polls all sessions once App starts the
 *  global sweep; detects new CI failures / review feedback and either surfaces
 *  an alert or (when auto mode is on) sends a fix turn to the session's agent.
 *
 *  A session can have several PRs: one replaced by another on the same
 *  branch, stacked PRs from one branch into different bases, or a PR the
 *  agent opened from a second branch. All are listed, but only the *primary*
 *  PR is watched — alerts, auto-fix, and the agent actions target it. The
 *  primary is the first entry of the (main-sorted) list: open before
 *  merged/closed, newest first — unless the user picks another one. */
class PrStore {
  prsBySession = $state<Record<string, PrInfo[]>>({});
  /** User-chosen primary PR number per session; falls back to the list head
   *  when unset or no longer in the list. */
  primaryBySession = $state<Record<string, number>>({});
  syncBySession = $state<Record<string, GitSyncStatus>>({});
  alertsBySession = $state<Record<string, PrAlert[]>>({});
  autoBySession = $state<Record<string, PrAutoConfig>>({});
  /** True after a fetch fails — the displayed PR data may be stale. */
  fetchFailedBySession = $state<Record<string, boolean>>({});

  private lastFetch = new Map<string, number>();
  /** Watch state per session, per PR number. Kept per PR so switching the
   *  primary back and forth doesn't replay a PR's old feedback as new. */
  private watchStates = new Map<string, Map<number, PrWatchState>>();
  /** Auto-fix attempts on the current head commit of the primary PR, per session. */
  private autoFixAttempts = new Map<string, { prNumber: number; sha: string; attempts: number }>();
  private globalTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping = false;
  private getPolledSessionIds: (() => string[]) | null = null;
  private nextAlertId = 1;

  /** Every PR tied to the session, primary first. */
  getPrs(sessionId: string): PrInfo[] {
    return this.prsBySession[sessionId] ?? [];
  }

  /** The primary PR — the one alerts and automation act on. */
  getPr(sessionId: string): PrInfo | null {
    const prs = this.getPrs(sessionId);
    const chosen = this.primaryBySession[sessionId];
    if (chosen !== undefined) {
      const match = prs.find((pr) => pr.number === chosen);
      if (match) return match;
    }
    return prs[0] ?? null;
  }

  /** Make one of the session's PRs the primary. Ignored for unknown numbers. */
  setPrimary(sessionId: string, prNumber: number): void {
    if (!this.getPrs(sessionId).some((pr) => pr.number === prNumber)) return;
    this.primaryBySession = { ...this.primaryBySession, [sessionId]: prNumber };
    // The newly primary PR seeds its own baseline on the next fetch; run
    // detection now so a PR already fetched doesn't wait a poll interval.
    this.handleDetection(sessionId);
  }

  getSync(sessionId: string): GitSyncStatus {
    return this.syncBySession[sessionId] ?? EMPTY_SYNC;
  }

  /** Alerts for the session's primary PR. */
  getAlerts(sessionId: string): PrAlert[] {
    const primary = this.getPr(sessionId)?.number;
    if (primary === undefined) return [];
    return (this.alertsBySession[sessionId] ?? []).filter((a) => a.prNumber === primary);
  }

  getAuto(sessionId: string): PrAutoConfig {
    return this.autoBySession[sessionId] ?? { fixCi: false, addressReviews: false };
  }

  setAuto(sessionId: string, patch: Partial<PrAutoConfig>): void {
    this.autoBySession = {
      ...this.autoBySession,
      [sessionId]: { ...this.getAuto(sessionId), ...patch },
    };
  }

  dismissAlert(sessionId: string, id: number): void {
    this.alertsBySession = {
      ...this.alertsBySession,
      [sessionId]: (this.alertsBySession[sessionId] ?? []).filter((a) => a.id !== id),
    };
  }

  async refresh(sessionId: string, force = false): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(sessionId) ?? 0;
    if (!force && now - last < THROTTLE_MS) return;
    this.lastFetch.set(sessionId, now);

    // The two fetches are independent: a gh failure (offline, auth, timeout)
    // must not discard a fresh local sync count, and vice versa. Whatever
    // succeeded is stored; a failure keeps the previous snapshot and flags
    // it stale rather than showing "no PR" for a branch that has one.
    const [pr, sync] = await Promise.allSettled([
      window.groveBench.getPrs(sessionId),
      window.groveBench.getGitSyncStatus(sessionId),
    ]);
    if (sync.status === 'fulfilled') {
      this.syncBySession = { ...this.syncBySession, [sessionId]: sync.value };
    }
    if (pr.status === 'fulfilled') {
      this.prsBySession = { ...this.prsBySession, [sessionId]: pr.value };
    }
    const failed = pr.status === 'rejected' || sync.status === 'rejected';
    if (failed !== (this.fetchFailedBySession[sessionId] ?? false)) {
      this.fetchFailedBySession = { ...this.fetchFailedBySession, [sessionId]: failed };
    }
    if (pr.status === 'rejected') console.error('Failed to fetch PR status:', pr.reason);
    if (sync.status === 'rejected') console.error('Failed to fetch branch sync status:', sync.reason);
    if (pr.status === 'fulfilled') this.handleDetection(sessionId);
  }

  /** Poll every open session (focused or not) — started once from App.
   *  Self-scheduling so a slow sweep never overlaps the next one. Sweeps are
   *  skipped while the window is hidden and one runs as soon as it is shown
   *  again, so a minimised app doesn't come back to minute-old checks. */
  startGlobalPolling(getSessionIds: () => string[]): void {
    if (this.getPolledSessionIds) return;
    this.getPolledSessionIds = getSessionIds;
    this.globalTimer = setTimeout(() => this.sweep(), POLL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Stop the global sweep (tests, teardown). */
  stopGlobalPolling(): void {
    if (this.globalTimer) clearTimeout(this.globalTimer);
    this.globalTimer = null;
    this.getPolledSessionIds = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private onVisibilityChange = (): void => {
    if (document.hidden || this.sweeping || !this.getPolledSessionIds) return;
    if (this.globalTimer) clearTimeout(this.globalTimer);
    this.globalTimer = null;
    void this.sweep();
  };

  /** One pass over every polled session. Sequential to avoid a burst of
   *  parallel gh processes, but bounded per session so a stuck fetch can't
   *  stall the rest. Always re-arms the next sweep, whatever happened. */
  private async sweep(): Promise<void> {
    if (this.sweeping || !this.getPolledSessionIds) return;
    this.sweeping = true;
    try {
      // Each refresh is a `gh` network call plus two git processes per
      // session; skip the sweep entirely while the window is hidden.
      if (typeof document === 'undefined' || !document.hidden) {
        for (const id of this.getPolledSessionIds()) {
          await withTimeout(this.refresh(id, true), SWEEP_REFRESH_TIMEOUT_MS);
        }
      }
    } catch (e) {
      console.error('PR status sweep failed:', e);
    } finally {
      this.sweeping = false;
      if (this.getPolledSessionIds !== null) this.globalTimer = setTimeout(() => this.sweep(), POLL_MS);
    }
  }

  /** Fetch when a status bar mounts — throttled, so rapid tab switching
   *  doesn't spawn a gh process per switch. Returns an unwatch fn (no-op —
   *  ongoing polling is global). */
  watch(sessionId: string): () => void {
    this.refresh(sessionId);
    return () => {};
  }

  /** Push the session branch to origin (sets upstream on first push). */
  async push(sessionId: string): Promise<void> {
    await window.groveBench.push(sessionId);
    await this.refresh(sessionId, true);
  }

  /** Push the branch and open a PR via the gh CLI (manual dialog path). */
  async createPr(sessionId: string, opts: PrCreateOpts): Promise<PrInfo> {
    const pr = await window.groveBench.createPr(sessionId, opts);
    // The new PR becomes primary: it goes to the head of the list and any
    // user override is dropped in its favour.
    const rest = this.getPrs(sessionId).filter((p) => p.number !== pr.number);
    this.prsBySession = { ...this.prsBySession, [sessionId]: [pr, ...rest] };
    const { [sessionId]: _chosen, ...restPrimary } = this.primaryBySession;
    this.primaryBySession = restPrimary;
    this.refresh(sessionId, true);
    return pr;
  }

  // ── Agent actions ──

  /** Send a turn asking the agent to fix the PR's failing checks.
   *  Returns false when the session can't take a turn right now. */
  fixCiWithAgent(sessionId: string): boolean {
    const pr = this.getPr(sessionId);
    if (!pr || !this.sessionIdle(sessionId)) return false;
    this.sendTurn(sessionId, buildFixCiPrompt(pr.number, this.branchOfPr(sessionId, pr), pr.failingChecks ?? []));
    this.clearAlerts(sessionId, 'ci_failed');
    return true;
  }

  /** Fetch the PR's review feedback and send a turn asking the agent to address it.
   *  trustedOnly (used by auto mode) drops comments from non-collaborators.
   *  Returns why nothing was sent so callers can surface it instead of failing silently. */
  async addressReviewsWithAgent(sessionId: string, opts: { trustedOnly?: boolean } = {}): Promise<'sent' | 'empty' | 'busy'> {
    const pr = this.getPr(sessionId);
    if (!pr || !this.sessionIdle(sessionId)) return 'busy';
    const all = await window.groveBench.getPrReviewComments(sessionId, pr.number);
    const comments = opts.trustedOnly ? all.filter((c) => isTrustedAssociation(c.authorAssociation)) : all;
    if (comments.length === 0) return 'empty';
    if (!this.sessionIdle(sessionId)) return 'busy'; // may have changed during the fetch
    this.sendTurn(sessionId, buildAddressReviewsPrompt(pr.number, this.branchOfPr(sessionId, pr), comments));
    this.clearAlerts(sessionId, 'new_comments');
    return 'sent';
  }

  // ── Detection + auto policy ──

  private handleDetection(sessionId: string): void {
    // Alerts are only raised for sessions with a live agent — an old/stopped
    // session has nothing actionable behind the alert. Detection is skipped
    // entirely (not run-and-suppressed) so the watch state doesn't advance:
    // feedback that arrives while a session is stopped still flags the next
    // time the session is running.
    const status = sessionStore.sessions.find((s) => s.id === sessionId)?.status;
    if (status !== 'running') return;

    // Only the primary PR is watched. Each PR keeps its own state so that
    // becoming primary later seeds from its current feedback, not from
    // whatever the previous primary had seen.
    const pr = this.getPr(sessionId);
    if (!pr) return;
    let states = this.watchStates.get(sessionId);
    if (!states) {
      states = new Map();
      this.watchStates.set(sessionId, states);
    }
    let state = states.get(pr.number);
    if (!state) {
      state = newPrWatchState();
      states.set(pr.number, state);
    }
    for (const event of detectPrEvents(state, pr)) {
      this.handleEvent(sessionId, pr.number, event);
    }
  }

  /** prNumber is the PR the event was detected on; alerts are pinned to it
   *  even if the primary changes while an auto action is in flight. */
  private handleEvent(sessionId: string, prNumber: number, event: PrWatchEvent): void {
    const auto = this.getAuto(sessionId);

    if (event.kind === 'ci_failed') {
      if (auto.fixCi) {
        const sha = this.getPr(sessionId)?.headSha ?? 'unknown';
        const prev = this.autoFixAttempts.get(sessionId);
        const attempts = prev?.prNumber === prNumber && prev.sha === sha ? prev.attempts : 0;
        if (attempts >= MAX_AUTO_FIX_ATTEMPTS) {
          this.addAlert(sessionId, prNumber, {
            kind: 'needs_human',
            reason: `Auto-fix attempted ${attempts}× on this commit without CI going green — take a look`,
          });
          return;
        }
        if (this.fixCiWithAgent(sessionId)) {
          this.autoFixAttempts.set(sessionId, { prNumber, sha, attempts: attempts + 1 });
          return;
        }
      }
      this.addAlert(sessionId, prNumber, { kind: 'ci_failed', checks: event.checks });
      return;
    }

    if (event.kind === 'new_comments') {
      if (auto.addressReviews) {
        this.addressReviewsWithAgent(sessionId, { trustedOnly: true }).then((result) => {
          // Nothing sent (busy, or all comments from non-collaborators) → surface it
          if (result !== 'sent') this.addAlert(sessionId, prNumber, { kind: 'new_comments', count: event.count });
        }).catch(() => {
          this.addAlert(sessionId, prNumber, { kind: 'new_comments', count: event.count });
        });
        return;
      }
      this.addAlert(sessionId, prNumber, { kind: 'new_comments', count: event.count });
    }
  }

  private addAlert(sessionId: string, prNumber: number, alert: PrAlertInput): void {
    // Replace any existing alert of the same kind on this PR rather than stacking duplicates
    const rest = (this.alertsBySession[sessionId] ?? []).filter((a) => a.kind !== alert.kind || a.prNumber !== prNumber);
    this.alertsBySession = {
      ...this.alertsBySession,
      [sessionId]: [...rest, { ...alert, id: this.nextAlertId++, prNumber }],
    };
    // Surface beyond the status-bar chip: flash the sidebar row for background
    // sessions, and raise a desktop notification while the window is unfocused.
    if (sessionStore.activeSessionId !== sessionId) {
      sessionStore.markNeedsAttention(sessionId);
    }
    notifyOs('pr_alert', sessionId, prAlertBody(alert));
  }

  /** Drop alerts of one kind on the primary PR (the one just acted on). */
  private clearAlerts(sessionId: string, kind: PrAlert['kind']): void {
    const prNumber = this.getPr(sessionId)?.number;
    this.alertsBySession = {
      ...this.alertsBySession,
      [sessionId]: (this.alertsBySession[sessionId] ?? []).filter((a) => a.kind !== kind || a.prNumber !== prNumber),
    };
  }

  private sendTurn(sessionId: string, prompt: string): void {
    messageStore.addUserMessage(sessionId, prompt);
    window.groveBench.sendMessage(sessionId, prompt);
    sessionStore.updateLastActive(sessionId);
  }

  private sessionIdle(sessionId: string): boolean {
    return !messageStore.getIsRunning(sessionId)
      && sessionStore.sessions.find((s) => s.id === sessionId)?.status === 'running';
  }

  /** The PR's own head branch — it may not be the session's recorded branch
   *  when the agent opened the PR from another branch — falling back to the
   *  session branch for PR data that predates headRefName. */
  private branchOfPr(sessionId: string, pr: PrInfo): string {
    return pr.headRefName || (sessionStore.sessions.find((s) => s.id === sessionId)?.branch ?? '');
  }

  clear(sessionId: string): void {
    this.lastFetch.delete(sessionId);
    this.watchStates.delete(sessionId);
    this.autoFixAttempts.delete(sessionId);
    const { [sessionId]: _p, ...restPrs } = this.prsBySession;
    this.prsBySession = restPrs;
    const { [sessionId]: _pri, ...restPrimary } = this.primaryBySession;
    this.primaryBySession = restPrimary;
    const { [sessionId]: _s, ...restSync } = this.syncBySession;
    this.syncBySession = restSync;
    const { [sessionId]: _a, ...restAlerts } = this.alertsBySession;
    this.alertsBySession = restAlerts;
    const { [sessionId]: _c, ...restAuto } = this.autoBySession;
    this.autoBySession = restAuto;
    const { [sessionId]: _f, ...restFailed } = this.fetchFailedBySession;
    this.fetchFailedBySession = restFailed;
  }
}

/** Resolve when `p` settles or after `ms`, whichever comes first. The
 *  promise is not cancelled — a late result still applies. */
function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(() => { clearTimeout(t); resolve(); }, () => { clearTimeout(t); resolve(); });
  });
}

function prAlertBody(alert: PrAlertInput): string {
  switch (alert.kind) {
    case 'ci_failed':
      return alert.checks.length > 0 ? `CI failing: ${alert.checks.join(', ')}` : 'CI checks are failing';
    case 'new_comments':
      return `${alert.count} new review comment${alert.count === 1 ? '' : 's'} on the PR`;
    case 'needs_human':
      return alert.reason;
  }
}

export const prStore = new PrStore();
