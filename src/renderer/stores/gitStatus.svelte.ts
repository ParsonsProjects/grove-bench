import type { GitStatusResult } from '../../shared/types.js';

const THROTTLE_MS = 500;

class GitStatusStore {
  statusBySession = $state<Record<string, GitStatusResult>>({});
  loadingBySession = $state<Record<string, boolean>>({});

  /** Sessions whose refreshes are currently suppressed (e.g. during history
   *  replay). Per-session rather than a single flag so concurrently-mounting
   *  panes can't clear each other's suppression. */
  private suppressedSessions = new Set<string>();

  private lastFetch = new Map<string, number>();
  private pendingTimeout = new Map<string, ReturnType<typeof setTimeout>>();

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
    this.loadingBySession = { ...this.loadingBySession, [sessionId]: true };

    try {
      const result = await window.groveBench.getGitStatus(sessionId);
      this.statusBySession = { ...this.statusBySession, [sessionId]: result };
    } catch (e) {
      console.error('Failed to fetch git status:', e);
    } finally {
      this.loadingBySession = { ...this.loadingBySession, [sessionId]: false };
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

  /** Revert a file via git checkout */
  async revertFile(sessionId: string, filePath: string, staged?: boolean): Promise<void> {
    await window.groveBench.revertFile(sessionId, filePath, staged);
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
    this.suppressedSessions.delete(sessionId);
    const { [sessionId]: _s, ...restStatus } = this.statusBySession;
    this.statusBySession = restStatus;
    const { [sessionId]: _l, ...restLoading } = this.loadingBySession;
    this.loadingBySession = restLoading;
  }
}

export const gitStatusStore = new GitStatusStore();
