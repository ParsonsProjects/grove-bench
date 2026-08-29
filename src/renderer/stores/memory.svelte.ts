import type {
  MemoryEntry,
  MemoryBackupInfo,
  MemoryBackupFile,
  MemoryCompactionStatus,
  MemoryStatsResult,
} from '../../shared/types.js';

class MemoryStore {
  files = $state<MemoryEntry[]>([]);
  selectedFile = $state<{ path: string; content: string } | null>(null);
  activeRepo = $state<string | null>(null);
  loading = $state(false);
  saving = $state(false);
  error = $state<string | null>(null);
  compacting = $state(false);
  compactMessage = $state<string | null>(null);
  backups = $state<MemoryBackupInfo[]>([]);
  stats = $state<MemoryStatsResult | null>(null);
  /** Result of the last manual compaction — drives the change-summary dialog and its Undo. */
  lastCompaction = $state<MemoryCompactionStatus | null>(null);
  undoing = $state(false);
  /** Preview of one backup snapshot's contents, keyed to backupPreviewId. */
  backupPreviewId = $state<string | null>(null);
  backupPreviewFiles = $state<MemoryBackupFile[]>([]);
  backupPreviewFile = $state<{ path: string; content: string } | null>(null);

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
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.saving = false;
    }
  }

  async compact() {
    if (!this.activeRepo || this.compacting) return;
    this.compacting = true;
    this.error = null;
    this.compactMessage = null;
    this.lastCompaction = null;
    try {
      const status = await window.groveBench.memoryCompact(this.activeRepo);
      if (status.compacted) {
        this.lastCompaction = status; // opens the change-summary dialog with Undo
      } else {
        this.compactMessage = `Nothing to compact${status.skippedReason ? ` (${status.skippedReason})` : ''}`;
      }
      this.selectedFile = null;
      this.files = await window.groveBench.memoryList(this.activeRepo);
      await this.loadStats();
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.compacting = false;
    }
  }

  /** Roll back the last manual compaction via its pre-apply snapshot. */
  async undoCompaction() {
    const backupId = this.lastCompaction?.backupId;
    if (!this.activeRepo || !backupId || this.undoing) return;
    this.undoing = true;
    this.error = null;
    try {
      const status = await window.groveBench.memoryRestoreBackup(this.activeRepo, backupId);
      if (status.restored) {
        this.lastCompaction = null;
        this.compactMessage = 'Compaction undone';
        this.selectedFile = null;
        this.files = await window.groveBench.memoryList(this.activeRepo);
        await this.loadStats();
      } else {
        this.error = status.error ?? 'Undo failed';
      }
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
    }
  }

  async readBackupFile(backupId: string, path: string) {
    if (!this.activeRepo) return;
    try {
      const content = await window.groveBench.memoryReadBackupFile(this.activeRepo, backupId, path);
      this.backupPreviewFile = { path, content: content ?? '(unreadable)' };
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
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
    } catch (e: any) {
      this.error = e.message || String(e);
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
      this.compactMessage = `Deleted ${relativePaths.length} session ${relativePaths.length === 1 ? 'note' : 'notes'}`;
      await this.loadStats();
    } catch (e: any) {
      this.error = e.message || String(e);
    }
  }
}

export const memoryStore = new MemoryStore();
