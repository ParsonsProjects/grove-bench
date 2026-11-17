import type { CheckpointDiffScope, CheckpointListItem, DiffHistoryEntry, DiffHistoryResult, FileDiffResult, FileLinesResult, GitStatusEntry, GitStatusResult } from '../../shared/types.js';
import { ipcErrorText } from '../lib/mcp-errors.js';

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
  /** Why the list couldn't be read, until it is. */
  errorBySession = $state<Record<string, string>>({});
  selectedBySession = $state<Record<string, string | null>>({});
  /** Files changed across the selected comparison (for the review panel). */
  filesBySession = $state<Record<string, GitStatusResult | null>>({});
  diffLoadingBySession = $state<Record<string, boolean>>({});
  historyBySession = $state<Record<string, DiffHistoryResult>>({});
  diffModeBySession = $state<Record<string, CheckpointDiffMode>>({});

  private lastFetch = new Map<string, number>();
  private pendingTimeout = new Map<string, ReturnType<typeof setTimeout>>();
  /** Latest list request per session: an older, slower reply is dropped. */
  private requestSeq = new Map<string, number>();

  getCheckpoints(sessionId: string): CheckpointListItem[] {
    return this.checkpointsBySession[sessionId] ?? [];
  }

  /** Whether the list has been read yet: until then an empty one means
   *  "not read", not "none". */
  hasLoaded(sessionId: string): boolean {
    return sessionId in this.checkpointsBySession;
  }

  isLoading(sessionId: string): boolean {
    return this.loadingBySession[sessionId] ?? false;
  }

  getError(sessionId: string): string | null {
    return this.errorBySession[sessionId] ?? null;
  }

  getSelected(sessionId: string): string | null {
    return this.selectedBySession[sessionId] ?? null;
  }

  getFiles(sessionId: string): GitStatusResult | null {
    return this.filesBySession[sessionId] ?? null;
  }

  /** The main-process scope for the current selection + mode. */
  getScope(sessionId: string): CheckpointDiffScope {
    if (this.getSelected(sessionId) === FULL_THREAD_UUID) return 'full';
    return this.getDiffMode(sessionId);
  }

  /** Identity of the current comparison, for the review panel's caches. */
  getSourceKey(sessionId: string): string {
    return `cp:${this.getSelected(sessionId) ?? ''}:${this.getScope(sessionId)}`;
  }

  loadFileDiff(sessionId: string, entry: GitStatusEntry): Promise<FileDiffResult> {
    const selected = this.getSelected(sessionId);
    if (!selected) return Promise.resolve({ kind: 'text', patch: '' });
    return window.groveBench.getCheckpointFileDiff(sessionId, selected, this.getScope(sessionId), entry.filePath);
  }

  loadFileLines(sessionId: string, entry: GitStatusEntry): Promise<FileLinesResult> {
    const selected = this.getSelected(sessionId);
    if (!selected) return Promise.resolve(null);
    return window.groveBench.getCheckpointFileLines(sessionId, selected, this.getScope(sessionId), entry.filePath);
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
    const seq = (this.requestSeq.get(sessionId) ?? 0) + 1;
    this.requestSeq.set(sessionId, seq);
    this.loadingBySession = { ...this.loadingBySession, [sessionId]: true };

    try {
      const [result, history] = await Promise.all([
        window.groveBench.listCheckpoints(sessionId),
        window.groveBench.getDiffHistory(sessionId).catch((e): DiffHistoryResult => {
          console.error('Failed to fetch diff history:', e);
          return EMPTY_HISTORY;
        }),
      ]);
      if (this.requestSeq.get(sessionId) !== seq) return;
      this.checkpointsBySession = { ...this.checkpointsBySession, [sessionId]: result };
      this.historyBySession = { ...this.historyBySession, [sessionId]: history };
      if (sessionId in this.errorBySession) {
        const { [sessionId]: _fixed, ...rest } = this.errorBySession;
        this.errorBySession = rest;
      }
    } catch (e) {
      console.error('Failed to fetch checkpoints:', e);
      // The list read last stays on screen, with this said above it.
      if (this.requestSeq.get(sessionId) === seq) {
        this.errorBySession = { ...this.errorBySession, [sessionId]: ipcErrorText(e) };
      }
    } finally {
      if (this.requestSeq.get(sessionId) === seq) {
        this.loadingBySession = { ...this.loadingBySession, [sessionId]: false };
      }
    }
  }

  /** Read the list now, however soon after the last (Try again). */
  reload(sessionId: string): Promise<void> {
    this.lastFetch.delete(sessionId);
    return this.refresh(sessionId);
  }

  scheduleRefresh(sessionId: string, delayMs = 500): void {
    const existing = this.pendingTimeout.get(sessionId);
    if (existing) clearTimeout(existing);

    this.pendingTimeout.set(
      sessionId,
      setTimeout(() => {
        this.pendingTimeout.delete(sessionId);
        this.lastFetch.delete(sessionId);
        void this.refresh(sessionId);
      }, delayMs),
    );
  }

  async selectCheckpoint(sessionId: string, uuid: string): Promise<void> {
    // Another comparison: its files aren't the last one's, so the panel says
    // it's loading rather than list those under the new heading meanwhile.
    if (this.getSelected(sessionId) !== uuid) this.dropFiles(sessionId);
    this.selectedBySession = { ...this.selectedBySession, [sessionId]: uuid };
    return this.loadFiles(sessionId);
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
    if (selected && selected !== FULL_THREAD_UUID) {
      this.dropFiles(sessionId);
      return this.loadFiles(sessionId);
    }
  }

  private dropFiles(sessionId: string): void {
    if (this.filesBySession[sessionId]) this.filesBySession = { ...this.filesBySession, [sessionId]: null };
  }

  /** Reload the current comparison's file list (e.g. after the agent edits).
   *  The list on screen stays until the new one is in. */
  async reloadFiles(sessionId: string): Promise<void> {
    return this.loadFiles(sessionId);
  }

  private async loadFiles(sessionId: string): Promise<void> {
    const selected = this.getSelected(sessionId);
    if (!selected) return;
    const scope = this.getScope(sessionId);

    this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: true };

    try {
      const files = await window.groveBench.getCheckpointFiles(sessionId, selected, scope);
      // Ignore stale responses if the selection or mode changed while loading
      if (this.getSelected(sessionId) !== selected || this.getScope(sessionId) !== scope) return;
      this.filesBySession = { ...this.filesBySession, [sessionId]: files };
    } catch (e) {
      console.error('Failed to load checkpoint files:', e);
      if (this.getSelected(sessionId) === selected && this.getScope(sessionId) === scope) {
        this.filesBySession = { ...this.filesBySession, [sessionId]: { entries: [], error: ipcErrorText(e) } };
      }
    } finally {
      if (this.getSelected(sessionId) === selected && this.getScope(sessionId) === scope) {
        this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: false };
      }
    }
  }

  clearSelection(sessionId: string): void {
    this.selectedBySession = { ...this.selectedBySession, [sessionId]: null };
    this.filesBySession = { ...this.filesBySession, [sessionId]: null };
    this.diffLoadingBySession = { ...this.diffLoadingBySession, [sessionId]: false };
  }

  clear(sessionId: string): void {
    const timeout = this.pendingTimeout.get(sessionId);
    if (timeout) clearTimeout(timeout);
    this.pendingTimeout.delete(sessionId);
    this.lastFetch.delete(sessionId);
    // Bumped, not deleted: a read still in flight then sees it is stale.
    this.requestSeq.set(sessionId, (this.requestSeq.get(sessionId) ?? 0) + 1);
    const { [sessionId]: _c, ...restCheckpoints } = this.checkpointsBySession;
    this.checkpointsBySession = restCheckpoints;
    const { [sessionId]: _l, ...restLoading } = this.loadingBySession;
    this.loadingBySession = restLoading;
    const { [sessionId]: _e, ...restErrors } = this.errorBySession;
    this.errorBySession = restErrors;
    const { [sessionId]: _s, ...restSelected } = this.selectedBySession;
    this.selectedBySession = restSelected;
    const { [sessionId]: _d, ...restFiles } = this.filesBySession;
    this.filesBySession = restFiles;
    const { [sessionId]: _dl, ...restDiffLoading } = this.diffLoadingBySession;
    this.diffLoadingBySession = restDiffLoading;
    const { [sessionId]: _h, ...restHistory } = this.historyBySession;
    this.historyBySession = restHistory;
    const { [sessionId]: _m, ...restMode } = this.diffModeBySession;
    this.diffModeBySession = restMode;
  }
}

export const checkpointStore = new CheckpointStore();
