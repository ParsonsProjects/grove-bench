import type { GitStatusResult } from '../../shared/types.js';

const THROTTLE_MS = 500;

class GitStatusStore {
  statusBySession = $state<Record<string, GitStatusResult>>({});
  loadingBySession = $state<Record<string, boolean>>({});
  /** Set true during history replay to suppress refresh triggers */
  suppressRefresh = false;

  private lastFetch = new Map<string, number>();
  private pendingTimeout = new Map<string, ReturnType<typeof setTimeout>>();

  getStatus(sessionId: string): GitStatusResult {
    return this.statusBySession[sessionId] ?? { entries: [] };
  }

  isLoading(sessionId: string): boolean {
    return this.loadingBySession[sessionId] ?? false;
  }

  async refresh(sessionId: string): Promise<void> {
    if (this.suppressRefresh) return;

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
    if (this.suppressRefresh) return;

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

  clear(sessionId: string): void {
    const timeout = this.pendingTimeout.get(sessionId);
    if (timeout) clearTimeout(timeout);
    this.pendingTimeout.delete(sessionId);
    this.lastFetch.delete(sessionId);
    const { [sessionId]: _s, ...restStatus } = this.statusBySession;
    this.statusBySession = restStatus;
    const { [sessionId]: _l, ...restLoading } = this.loadingBySession;
    this.loadingBySession = restLoading;
  }
}

export const gitStatusStore = new GitStatusStore();
