import type {
  MemoryEntry,
  MemoryBackupInfo,
  MemoryBackupFile,
  MemoryCompactionEvent,
  MemoryCompactionStage,
  MemoryCompactionStatus,
  MemoryStatsResult,
} from '../../shared/types.js';
import { errorMessage } from '../../shared/error-message.js';

export interface MemoryToast {
  kind: 'success' | 'info' | 'error';
  message: string;
  /** Offer a "View" action that opens the memory panel. */
  showView?: boolean;
}

class MemoryStore {
  files = $state<MemoryEntry[]>([]);
  selectedFile = $state<{ path: string; content: string } | null>(null);
  activeRepo = $state<string | null>(null);
  loading = $state(false);
  saving = $state(false);
  error = $state<string | null>(null);
  compacting = $state(false);
  /** Project the running manual compaction is for. The panel can switch
   *  projects meanwhile; cancel, progress, the result and its Undo stay
   *  with this one. */
  compactingRepo = $state<string | null>(null);
  compactMessage = $state<string | null>(null);
  backups = $state<MemoryBackupInfo[]>([]);
  stats = $state<MemoryStatsResult | null>(null);
  /** Result of the last manual compaction — drives the change-summary dialog and its Undo. */
  lastCompaction = $state<MemoryCompactionStatus | null>(null);
  /** Project lastCompaction belongs to, which its Undo restores. */
  private lastCompactionRepo: string | null = null;
  undoing = $state(false);
  /** Preview of one backup snapshot's contents, keyed to backupPreviewId. */
  backupPreviewId = $state<string | null>(null);
  backupPreviewFiles = $state<MemoryBackupFile[]>([]);
  backupPreviewFile = $state<{ path: string; content: string } | null>(null);

  /** Whether the memory panel dialog is open — global so the status bar and toasts can open it. */
  panelOpen = $state(false);
  /** Current stage of the running compaction pass, from main-process events. */
  compactStage = $state<MemoryCompactionStage | null>(null);
  /** Which merge step of how many is running, while compactStage is 'merging'. */
  compactStep = $state<{ step: number; total: number } | null>(null);
  /** Seconds since the manual compaction started — the panel's "still alive" ticker. */
  compactElapsedSeconds = $state(0);
  /** Transient notification shown by MemoryToast — survives the panel being closed. */
  toast = $state<MemoryToast | null>(null);

  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private compactStartedAt: number | null = null;
  private eventsSubscribed = false;

  /** Subscribe to main-process compaction events. Call once at app startup. */
  init() {
    if (this.eventsSubscribed) return;
    this.eventsSubscribed = true;
    window.groveBench.onMemoryCompactEvent((e) => this.handleCompactionEvent(e));
  }

  private handleCompactionEvent(e: MemoryCompactionEvent) {
    // A run is finalized by the compact() promise itself.
    if (e.kind !== 'stage' || e.repoPath !== this.compactingRepo) return;
    this.compactStage = e.stage;
    this.compactStep = e.step !== undefined && e.total !== undefined ? { step: e.step, total: e.total } : null;
  }

  private startElapsedTimer() {
    this.compactStartedAt = Date.now();
    this.compactElapsedSeconds = 0;
    this.elapsedTimer = setInterval(() => {
      if (this.compactStartedAt !== null) {
        this.compactElapsedSeconds = Math.floor((Date.now() - this.compactStartedAt) / 1000);
      }
    }, 1000);
  }

  private stopElapsedTimer() {
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
    this.compactStartedAt = null;
    this.compactStage = null;
    this.compactStep = null;
  }

  /** Group files by folder for tree display */
  get filesByFolder(): Record<string, MemoryEntry[]> {
    const groups: Record<string, MemoryEntry[]> = {};
    for (const file of this.files) {
      const folder = file.folder || '.';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(file);
    }
    return groups;
  }

  get folders(): string[] {
    return Object.keys(this.filesByFolder).sort();
  }

  /**
   * Session notes last updated before the cutoff, oldest first.
   * Notes without a parseable updatedAt get ts=0 and are listed first as "unknown date" —
   * they are surfaced for the user to decide on, never silently excluded.
   */
  sessionNotesOlderThan(days: number): Array<MemoryEntry & { ts: number }> {
    const cutoff = Date.now() - days * 86_400_000;
    return this.files
      .filter(f => f.folder.startsWith('sessions'))
      .map(f => ({ ...f, ts: Date.parse(f.updatedAt) || 0 }))
      .filter(f => f.ts < cutoff)
      .sort((a, b) => a.ts - b.ts);
  }

  async loadForRepo(repoPath: string) {
    this.activeRepo = repoPath;
    this.loading = true;
    this.error = null;
    this.selectedFile = null;
    this.compactMessage = null;
    this.backups = [];
    this.lastCompaction = null;
    try {
      this.files = await window.groveBench.memoryList(repoPath);
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
    await this.loadStats();
  }

  async loadStats() {
    if (!this.activeRepo) return;
    try {
      this.stats = await window.groveBench.memoryStats(this.activeRepo);
    } catch {
      this.stats = null; // meter is decorative — never surface an error for it
    }
  }

  async readFile(relativePath: string) {
    if (!this.activeRepo) return;
    this.loading = true;
    this.error = null;
    try {
      const content = await window.groveBench.memoryRead(this.activeRepo, relativePath);
      this.selectedFile = { path: relativePath, content: content ?? '' };
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
  }

  async writeFile(relativePath: string, content: string) {
    if (!this.activeRepo) return;
    this.saving = true;
    this.error = null;
    try {
      await window.groveBench.memoryWrite(this.activeRepo, relativePath, content);
      if (this.selectedFile?.path === relativePath) {
        this.selectedFile = { path: relativePath, content };
      }
      // Refresh the file list
      this.files = await window.groveBench.memoryList(this.activeRepo);
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.saving = false;
    }
  }

  async compact() {
    const repo = this.activeRepo;
    if (!repo || this.compacting) return;
    this.compacting = true;
    this.compactingRepo = repo;
    this.error = null;
    this.compactMessage = null;
    this.lastCompaction = null;
    this.toast = null;
    this.startElapsedTimer();
    try {
      const status = await window.groveBench.memoryCompact(repo);
      if (status.compacted) {
        this.lastCompaction = status; // opens the change-summary dialog with Undo
        this.lastCompactionRepo = repo;
      } else if (status.error) {
        const message = `Compaction failed: ${status.error}`;
        if (this.panelOpen) this.error = message;
        else this.toast = { kind: 'error', message };
      } else if (status.skippedReason === 'cancelled') {
        if (this.panelOpen) this.compactMessage = 'Compaction cancelled';
        else this.toast = { kind: 'info', message: 'Compaction cancelled' };
      } else {
        const message = `Nothing to compact${status.skippedReason ? ` (${status.skippedReason})` : ''}`;
        if (this.panelOpen) this.compactMessage = message;
        else this.toast = { kind: 'info', message };
      }
      // Refresh the view only if it still shows this project.
      if (this.activeRepo === repo) {
        this.selectedFile = null;
        this.files = await window.groveBench.memoryList(repo);
        await this.loadStats();
      }
    } catch (e) {
      if (this.panelOpen) this.error = errorMessage(e);
      else this.toast = { kind: 'error', message: errorMessage(e) };
    } finally {
      this.stopElapsedTimer();
      this.compacting = false;
      this.compactingRepo = null;
    }
  }

  /** Ask the main process to abort the running compaction pass. */
  async cancelCompact() {
    const repo = this.compactingRepo;
    if (!repo || !this.compacting) return;
    try {
      await window.groveBench.memoryCompactCancel(repo);
      // compact()'s pending promise resolves with the cancelled status
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  /** Roll back the last manual compaction via its pre-apply snapshot. */
  async undoCompaction() {
    const backupId = this.lastCompaction?.backupId;
    const repo = this.lastCompactionRepo;
    if (!repo || !backupId || this.undoing) return;
    this.undoing = true;
    this.error = null;
    try {
      const status = await window.groveBench.memoryRestoreBackup(repo, backupId);
      if (status.restored) {
        this.lastCompaction = null;
        this.compactMessage = 'Compaction undone';
        if (this.activeRepo === repo) {
          this.selectedFile = null;
          this.files = await window.groveBench.memoryList(repo);
          await this.loadStats();
        }
      } else {
        this.error = status.error ?? 'Undo failed';
      }
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.undoing = false;
    }
  }

  async previewBackup(backupId: string) {
    if (!this.activeRepo) return;
    if (this.backupPreviewId === backupId) {
      // Toggle off
      this.backupPreviewId = null;
      this.backupPreviewFiles = [];
      this.backupPreviewFile = null;
      return;
    }
    this.error = null;
    try {
      this.backupPreviewFiles = await window.groveBench.memoryBackupPreview(this.activeRepo, backupId);
      this.backupPreviewId = backupId;
      this.backupPreviewFile = null;
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async readBackupFile(backupId: string, path: string) {
    if (!this.activeRepo) return;
    try {
      const content = await window.groveBench.memoryReadBackupFile(this.activeRepo, backupId, path);
      this.backupPreviewFile = { path, content: content ?? '(unreadable)' };
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async loadBackups() {
    if (!this.activeRepo) return;
    this.error = null;
    this.backupPreviewId = null;
    this.backupPreviewFiles = [];
    this.backupPreviewFile = null;
    try {
      this.backups = await window.groveBench.memoryListBackups(this.activeRepo);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async restoreBackup(backupId: string) {
    if (!this.activeRepo) return;
    this.error = null;
    this.compactMessage = null;
    try {
      const status = await window.groveBench.memoryRestoreBackup(this.activeRepo, backupId);
      if (status.restored) {
        this.compactMessage = `Restored ${status.filesChanged.length} files from backup`;
        this.selectedFile = null;
        this.files = await window.groveBench.memoryList(this.activeRepo);
        this.backups = await window.groveBench.memoryListBackups(this.activeRepo);
        await this.loadStats();
      } else {
        this.error = status.error ?? 'Restore failed';
      }
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async deleteFile(relativePath: string) {
    if (!this.activeRepo) return;
    this.error = null;
    try {
      await window.groveBench.memoryDelete(this.activeRepo, relativePath);
      if (this.selectedFile?.path === relativePath) {
        this.selectedFile = null;
      }
      this.files = await window.groveBench.memoryList(this.activeRepo);
    } catch (e) {
      this.error = errorMessage(e);
    }
  }

  async deleteFiles(relativePaths: string[]) {
    if (!this.activeRepo || relativePaths.length === 0) return;
    this.error = null;
    this.compactMessage = null;
    try {
      for (const p of relativePaths) {
        await window.groveBench.memoryDelete(this.activeRepo, p);
      }
      if (this.selectedFile && relativePaths.includes(this.selectedFile.path)) {
        this.selectedFile = null;
      }
      this.files = await window.groveBench.memoryList(this.activeRepo);
      this.compactMessage = `Deleted ${relativePaths.length} thread ${relativePaths.length === 1 ? 'note' : 'notes'}`;
      await this.loadStats();
    } catch (e) {
      this.error = errorMessage(e);
    }
  }
}

export const memoryStore = new MemoryStore();
