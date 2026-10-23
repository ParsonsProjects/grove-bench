import type { DiffScope, GitStatusResult } from '../../shared/types.js';
import { store as sessionStore } from './sessions.svelte.js';
import { settingsStore } from './settings.svelte.js';

export interface ScopeState {
  scope: DiffScope;
  base?: string;
  /** The default, not picked by the user: its base follows the open PR and
   *  the settings, and it shows the uncommitted changes when there's no
   *  branch view to draw (no commits yet, or no such base branch). */
  auto?: boolean;
}

const THROTTLE_MS = 500;

class GitStatusStore {
  statusBySession = $state<Record<string, GitStatusResult>>({});
  loadingBySession = $state<Record<string, boolean>>({});
  /** What each session's Changes tab compares against. By default the whole
   *  branch since its base, worked out on each refresh (see autoBase). */
  scopeBySession = $state<Record<string, ScopeState>>({});

  /** Sessions whose refreshes are currently suppressed (e.g. during history
   *  replay). Per-session rather than a single flag so concurrently-mounting
   *  panes can't clear each other's suppression. */
  private suppressedSessions = new Set<string>();

  private lastFetch = new Map<string, number>();
  /** Latest request per session. A slower, older response (the previous
   *  scope, or a conversation deleted meanwhile) is dropped. */
  private requestSeq = new Map<string, number>();
  private pendingTimeout = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each session's repo default branch, looked up once. */
  private detectedBases = new Map<string, Promise<string>>();
  /** The base of the session's open PR, if any (set by the PR store). */
  private prBase: ((sessionId: string) => string | undefined) | null = null;

  /** Suppress refresh triggers for a session (call before replaying its history). */
  suppressRefresh(sessionId: string): void {
    this.suppressedSessions.add(sessionId);
  }

  /** Re-enable refresh triggers for a session (call after replay completes). */
  unsuppressRefresh(sessionId: string): void {
    this.suppressedSessions.delete(sessionId);
  }

  getStatus(sessionId: string): GitStatusResult {
    return this.statusBySession[sessionId] ?? { entries: [] };
  }

  getScope(sessionId: string): ScopeState {
    return this.scopeBySession[sessionId] ?? { scope: 'branch', auto: true };
  }

  /** Where the default branch view gets the open PR's base from. */
  setPrBaseSource(source: (sessionId: string) => string | undefined): void {
    this.prBase = source;
  }

  /** The session's open PR changed: a default view that has been shown
   *  re-reads against the new base. */
  prBaseChanged(sessionId: string): void {
    if (this.getScope(sessionId).auto && sessionId in this.statusBySession) this.scheduleRefresh(sessionId);
  }

  /** The default view's base: the open PR's base branch (so the view is the
   *  PR's diff), else the one in Settings, else the repo's default branch. */
  private autoBase(sessionId: string): Promise<string> {
    const chosen = this.prBase?.(sessionId) || settingsStore.current.defaultBaseBranch?.trim();
    if (chosen) return Promise.resolve(chosen);
    const repoPath = sessionStore.sessions.find((s) => s.id === sessionId)?.repoPath;
    // Not listed yet: guess, and look it up properly next time.
    if (!repoPath) return Promise.resolve('main');
    let lookup = this.detectedBases.get(sessionId);
    if (!lookup) {
      lookup = window.groveBench.getDefaultBranch(repoPath).then((b) => b?.trim() || 'main', () => 'main');
      this.detectedBases.set(sessionId, lookup);
    }
    return lookup;
  }

  /** Update the default view, unless the user has picked a scope meanwhile. */
  private setAutoScope(sessionId: string, next: ScopeState): void {
    const current = this.scopeBySession[sessionId];
    if (current && (!current.auto || (current.scope === next.scope && current.base === next.base))) return;
    this.scopeBySession = { ...this.scopeBySession, [sessionId]: { ...next, auto: true } };
  }

  /** Switch scope and refetch right away (bypassing the throttle). */
  async setScope(sessionId: string, scope: DiffScope, base?: string): Promise<void> {
    this.scopeBySession = { ...this.scopeBySession, [sessionId]: { scope, base } };
    this.lastFetch.delete(sessionId);
    await this.refresh(sessionId);
  }

  isLoading(sessionId: string): boolean {
    return this.loadingBySession[sessionId] ?? false;
  }

  async refresh(sessionId: string): Promise<void> {
    if (this.suppressedSessions.has(sessionId)) return;

    // Throttle: skip if called too recently
    const now = Date.now();
    const last = this.lastFetch.get(sessionId) ?? 0;
    if (now - last < THROTTLE_MS) return;

    this.lastFetch.set(sessionId, now);
    const seq = (this.requestSeq.get(sessionId) ?? 0) + 1;
    this.requestSeq.set(sessionId, seq);
    this.loadingBySession = { ...this.loadingBySession, [sessionId]: true };
    // Whatever changed the files may have switched branches too.
    void sessionStore.syncBranch(sessionId);

    try {
      const state = this.getScope(sessionId);
      let { scope, base } = state;
      if (state.auto) {
        const wanted = await this.autoBase(sessionId);
        if (this.requestSeq.get(sessionId) !== seq) return;
        // After falling back to the uncommitted view, try the branch view
        // again only once there's a different base to try.
        if (scope === 'branch' || wanted !== base) {
          scope = 'branch';
          base = wanted;
          this.setAutoScope(sessionId, { scope, base });
        }
      }
      let result = scope === 'branch'
        ? await window.groveBench.getGitStatus(sessionId, { scope, base })
        : await window.groveBench.getGitStatus(sessionId);
      if (this.requestSeq.get(sessionId) !== seq) return;
      if (state.auto && scope === 'branch' && result.scopeError) {
        // No branch view here: show the uncommitted changes rather than
        // only an error, as the tab did before the branch view was default.
        this.setAutoScope(sessionId, { scope: 'working', base });
        result = await window.groveBench.getGitStatus(sessionId);
        if (this.requestSeq.get(sessionId) !== seq) return;
      }
      this.statusBySession = { ...this.statusBySession, [sessionId]: result };
    } catch (e) {
      console.error('Failed to fetch git status:', e);
    } finally {
      if (this.requestSeq.get(sessionId) === seq) {
        this.loadingBySession = { ...this.loadingBySession, [sessionId]: false };
      }
    }
  }

  scheduleRefresh(sessionId: string, delayMs = 300): void {
    if (this.suppressedSessions.has(sessionId)) return;

    // Debounce: cancel any pending refresh and schedule a new one
    const existing = this.pendingTimeout.get(sessionId);
    if (existing) clearTimeout(existing);

    this.pendingTimeout.set(
      sessionId,
      setTimeout(() => {
        this.pendingTimeout.delete(sessionId);
        // Reset throttle so the debounced call always goes through
        this.lastFetch.delete(sessionId);
        this.refresh(sessionId);
      }, delayMs),
    );
  }

  // ── Git write actions (proxy the CLI via IPC, then refresh status) ──

  /** Revert a file via git checkout, or undo a rename (`renamedFrom`, its old path). */
  async revertFile(sessionId: string, filePath: string, staged?: boolean, renamedFrom?: string): Promise<void> {
    await window.groveBench.revertFile(sessionId, filePath, staged, renamedFrom);
    this.scheduleRefresh(sessionId, 100);
  }

  /** Stage a file (git add) */
  async stageFile(sessionId: string, filePath: string): Promise<void> {
    await window.groveBench.stageFile(sessionId, filePath);
    this.scheduleRefresh(sessionId, 100);
  }

  /** Unstage a file (git reset HEAD) */
  async unstageFile(sessionId: string, filePath: string): Promise<void> {
    await window.groveBench.unstageFile(sessionId, filePath);
    this.scheduleRefresh(sessionId, 100);
  }

  /** Commit staged changes */
  async commit(sessionId: string, message: string): Promise<void> {
    await window.groveBench.commit(sessionId, message);
    this.scheduleRefresh(sessionId, 100);
  }

  clear(sessionId: string): void {
    const timeout = this.pendingTimeout.get(sessionId);
    if (timeout) clearTimeout(timeout);
    this.pendingTimeout.delete(sessionId);
    this.lastFetch.delete(sessionId);
    this.requestSeq.delete(sessionId);
    this.detectedBases.delete(sessionId);
    this.suppressedSessions.delete(sessionId);
    const { [sessionId]: _s, ...restStatus } = this.statusBySession;
    this.statusBySession = restStatus;
    const { [sessionId]: _l, ...restLoading } = this.loadingBySession;
    this.loadingBySession = restLoading;
    const { [sessionId]: _sc, ...restScope } = this.scopeBySession;
    this.scopeBySession = restScope;
  }
}

export const gitStatusStore = new GitStatusStore();
