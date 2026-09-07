import type { CheckpointListItem, DiffHistoryEntry, DiffHistoryResult } from '../../shared/types.js';

const THROTTLE_MS = 500;

/** Sentinel selection for the cumulative full-thread diff (all turns). */
export const FULL_THREAD_UUID = '__full_thread__';

/** Which diff to show for a selected checkpoint:
 *  'turn' = what that turn changed; 'since' = everything changed since it (rewind preview). */
export type CheckpointDiffMode = 'turn' | 'since';

const EMPTY_HISTORY: DiffHistoryResult = {
  entries: [],
  total: { filesChanged: 0, additions: 0, deletions: 0 },
};

class CheckpointStore {
  checkpointsBySession = $state<Record<string, CheckpointListItem[]>>({});
  loadingBySession = $state<Record<string, boolean>>({});
  selectedBySession = $state<Record<string, string | null>>({});
  diffBySession = $state<Record<string, string | null>>({});
  diffLoadingBySession = $state<Record<string, boolean>>({});
  historyBySession = $state<Record<string, DiffHistoryResult>>({});
  diffModeBySession = $state<Record<string, CheckpointDiffMode>>({});

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

  getHistory(sessionId: string): DiffHistoryResult {
    return this.historyBySession[sessionId] ?? EMPTY_HISTORY;
  }

  getHistoryEntry(sessionId: string, uuid: string): DiffHistoryEntry | undefined {
    return this.getHistory(sessionId).entries.find(e => e.uuid === uuid);
  }

  getDiffMode(sessionId: string): CheckpointDiffMode {
    return this.diffModeBySession[sessionId] ?? 'turn';
  }

  async refresh(sessionId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(sessionId) ?? 0;
    if (now - last < THROTTLE_MS) return;

    this.lastFetch.set(sessionId, now);
    this.loadingBySession = { ...this.loadingBySession, [sessionId]: true };

    try {
      const [result, history] = await Promise.all([
        window.groveBench.listCheckpoints(sessionId),
        window.groveBench.getDiffHistory(sessionId).catch((e): DiffHistoryResult => {
          console.error('Failed to fetch diff history:', e);
          return EMPTY_HISTORY;
        }),
      ]);
      this.checkpointsBySession = { ...this.checkpointsBySession, [sessionId]: result };
      this.historyBySession = { ...this.historyBySession, [sessionId]: history };
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
    return this.loadDiff(sessionId);
  }

  /** Select the cumulative full-thread diff (all changes across all turns). */
  async selectFullThread(sessionId: string): Promise<void> {
    return this.selectCheckpoint(sessionId, FULL_THREAD_UUID);
  }

  /** Switch between per-turn and since-checkpoint diffs, reloading the current one. */
  async setDiffMode(sessionId: string, mode: CheckpointDiffMode): Promise<void> {
    if (this.getDiffMode(sessionId) === mode) return;
    this.diffModeBySession = { ...this.diffModeBySession, [sessionId]: mode };
    const selected = this.getSelected(sessionId);
    if (selected && selected !== FULL_THREAD_UUID) return this.loadDiff(sessionId);
  }

  private async loadDiff(sessionId: string): Promise<void> {
    const selected = this.getSelected(sessionId);
    if (!selected) return;

    this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: true };
    this.diffBySession = { ...this.diffBySession, [sessionId]: null };

    try {
      let diff: string;
      if (selected === FULL_THREAD_UUID) {
        diff = await window.groveBench.getFullThreadDiff(sessionId);
      } else if (this.getDiffMode(sessionId) === 'turn') {
        diff = await window.groveBench.getTurnDiff(sessionId, selected);
      } else {
        diff = await window.groveBench.getCheckpointDiff(sessionId, selected);
      }
      // Ignore stale responses if the selection changed while loading
      if (this.getSelected(sessionId) !== selected) return;
      this.diffBySession = { ...this.diffBySession, [sessionId]: diff };
    } catch (e) {
      console.error('Failed to load checkpoint diff:', e);
    } finally {
      if (this.getSelected(sessionId) === selected) {
        this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: false };
      }
    }
  }

  clearSelection(sessionId: string): void {
    this.selectedBySession = { ...this.selectedBySession, [sessionId]: null };
    this.diffBySession = { ...this.diffBySession, [sessionId]: null };
    this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: false };
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
    const { [sessionId]: _h, ...restHistory } = this.historyBySession;
    this.historyBySession = restHistory;
    const { [sessionId]: _m, ...restMode } = this.diffModeBySession;
    this.diffModeBySession = restMode;
  }
}

export const checkpointStore = new CheckpointStore();
