import type { CheckpointListItem } from '../../shared/types.js';

const THROTTLE_MS = 500;

class CheckpointStore {
  checkpointsBySession = $state<Record<string, CheckpointListItem[]>>({});
  loadingBySession = $state<Record<string, boolean>>({});
  selectedBySession = $state<Record<string, string | null>>({});
  diffBySession = $state<Record<string, string | null>>({});
  diffLoadingBySession = $state<Record<string, boolean>>({});

  private lastFetch = new Map<string, number>();
  private pendingTimeout = new Map<string, ReturnType<typeof setTimeout>>();

  getCheckpoints(sessionId: string): CheckpointListItem[] {
    return this.checkpointsBySession[sessionId] ?? [];
  }

  isLoading(sessionId: string): boolean {
    return this.loadingBySession[sessionId] ?? false;
  }

  getSelected(sessionId: string): string | null {
    return this.selectedBySession[sessionId] ?? null;
  }

  getDiff(sessionId: string): string | null {
    return this.diffBySession[sessionId] ?? null;
  }

  isDiffLoading(sessionId: string): boolean {
    return this.diffLoadingBySession[sessionId] ?? false;
  }

  async refresh(sessionId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(sessionId) ?? 0;
    if (now - last < THROTTLE_MS) return;

    this.lastFetch.set(sessionId, now);
    this.loadingBySession = { ...this.loadingBySession, [sessionId]: true };

    try {
      const result = await window.groveBench.listCheckpoints(sessionId);
      this.checkpointsBySession = { ...this.checkpointsBySession, [sessionId]: result };
    } catch (e) {
      console.error('Failed to fetch checkpoints:', e);
    } finally {
      this.loadingBySession = { ...this.loadingBySession, [sessionId]: false };
    }
  }

  scheduleRefresh(sessionId: string, delayMs = 500): void {
    const existing = this.pendingTimeout.get(sessionId);
    if (existing) clearTimeout(existing);

    this.pendingTimeout.set(
      sessionId,
      setTimeout(() => {
        this.pendingTimeout.delete(sessionId);
        this.lastFetch.delete(sessionId);
        this.refresh(sessionId);
      }, delayMs),
    );
  }

  async selectCheckpoint(sessionId: string, uuid: string): Promise<void> {
    this.selectedBySession = { ...this.selectedBySession, [sessionId]: uuid };
    this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: true };
    this.diffBySession = { ...this.diffBySession, [sessionId]: null };

    try {
      const diff = await window.groveBench.getCheckpointDiff(sessionId, uuid);
      this.diffBySession = { ...this.diffBySession, [sessionId]: diff };
    } catch (e) {
      console.error('Failed to load checkpoint diff:', e);
    } finally {
      this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: false };
    }
  }

  clearSelection(sessionId: string): void {
    this.selectedBySession = { ...this.selectedBySession, [sessionId]: null };
    this.diffBySession = { ...this.diffBySession, [sessionId]: null };
  }

  clear(sessionId: string): void {
    const timeout = this.pendingTimeout.get(sessionId);
    if (timeout) clearTimeout(timeout);
    this.pendingTimeout.delete(sessionId);
    this.lastFetch.delete(sessionId);
    const { [sessionId]: _c, ...restCheckpoints } = this.checkpointsBySession;
    this.checkpointsBySession = restCheckpoints;
    const { [sessionId]: _l, ...restLoading } = this.loadingBySession;
    this.loadingBySession = restLoading;
    const { [sessionId]: _s, ...restSelected } = this.selectedBySession;
    this.selectedBySession = restSelected;
    const { [sessionId]: _d, ...restDiff } = this.diffBySession;
    this.diffBySession = restDiff;
    const { [sessionId]: _dl, ...restDiffLoading } = this.diffLoadingBySession;
    this.diffLoadingBySession = restDiffLoading;
  }
}

export const checkpointStore = new CheckpointStore();
