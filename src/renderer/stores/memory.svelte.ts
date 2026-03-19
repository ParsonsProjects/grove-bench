import type { MemoryEntry } from '../../shared/types.js';

class MemoryStore {
  files = $state<MemoryEntry[]>([]);
  selectedFile = $state<{ path: string; content: string } | null>(null);
  activeRepo = $state<string | null>(null);
  loading = $state(false);
  saving = $state(false);
  error = $state<string | null>(null);

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

  async loadForRepo(repoPath: string) {
    this.activeRepo = repoPath;
    this.loading = true;
    this.error = null;
    this.selectedFile = null;
    try {
      this.files = await window.groveBench.memoryList(repoPath);
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
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
}

export const memoryStore = new MemoryStore();
