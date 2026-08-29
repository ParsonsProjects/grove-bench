import type { PrInfo, GitSyncStatus, PrCreateOpts } from '../../shared/types.js';

const POLL_MS = 60_000;
const THROTTLE_MS = 5_000;

const EMPTY_SYNC: GitSyncStatus = { upstream: null, ahead: 0, behind: 0 };

/** PR + branch-sync state per session, polled while a status bar is watching. */
class PrStore {
  prBySession = $state<Record<string, PrInfo | null>>({});
  syncBySession = $state<Record<string, GitSyncStatus>>({});

  private lastFetch = new Map<string, number>();
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private watcherCounts = new Map<string, number>();

  getPr(sessionId: string): PrInfo | null {
    return this.prBySession[sessionId] ?? null;
  }

  getSync(sessionId: string): GitSyncStatus {
    return this.syncBySession[sessionId] ?? EMPTY_SYNC;
  }

  async refresh(sessionId: string, force = false): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(sessionId) ?? 0;
    if (!force && now - last < THROTTLE_MS) return;
    this.lastFetch.set(sessionId, now);

    try {
      const [pr, sync] = await Promise.all([
        window.groveBench.getPrInfo(sessionId),
        window.groveBench.getGitSyncStatus(sessionId),
      ]);
      this.prBySession = { ...this.prBySession, [sessionId]: pr };
      this.syncBySession = { ...this.syncBySession, [sessionId]: sync };
    } catch (e) {
      console.error('Failed to fetch PR status:', e);
    }
  }

  /** Poll while at least one component displays this session. Returns an unwatch fn. */
  watch(sessionId: string): () => void {
    const count = (this.watcherCounts.get(sessionId) ?? 0) + 1;
    this.watcherCounts.set(sessionId, count);
    if (count === 1) {
      this.refresh(sessionId, true);
      this.pollTimers.set(
        sessionId,
        setInterval(() => this.refresh(sessionId, true), POLL_MS),
      );
    }
    return () => {
      const remaining = (this.watcherCounts.get(sessionId) ?? 1) - 1;
      if (remaining <= 0) {
        this.watcherCounts.delete(sessionId);
        const timer = this.pollTimers.get(sessionId);
        if (timer) clearInterval(timer);
        this.pollTimers.delete(sessionId);
      } else {
        this.watcherCounts.set(sessionId, remaining);
      }
    };
  }

  /** Push the session branch to origin (sets upstream on first push). */
  async push(sessionId: string): Promise<void> {
    await window.groveBench.push(sessionId);
    await this.refresh(sessionId, true);
  }

  /** Push the branch and open a PR via the gh CLI. */
  async createPr(sessionId: string, opts: PrCreateOpts): Promise<PrInfo> {
    const pr = await window.groveBench.createPr(sessionId, opts);
    this.prBySession = { ...this.prBySession, [sessionId]: pr };
    this.refresh(sessionId, true);
    return pr;
  }

  clear(sessionId: string): void {
    const timer = this.pollTimers.get(sessionId);
    if (timer) clearInterval(timer);
    this.pollTimers.delete(sessionId);
    this.watcherCounts.delete(sessionId);
    this.lastFetch.delete(sessionId);
    const { [sessionId]: _p, ...restPr } = this.prBySession;
    this.prBySession = restPr;
    const { [sessionId]: _s, ...restSync } = this.syncBySession;
    this.syncBySession = restSync;
  }
}

export const prStore = new PrStore();
