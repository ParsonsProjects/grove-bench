import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { memoryStore } from './memory.svelte.js';
import type { MemoryEntry } from '../../shared/types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    relativePath: 'repo/overview.md',
    title: 'Overview',
    updatedAt: '2026-01-01',
    folder: 'repo',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryStore.files = [];
  memoryStore.selectedFile = null;
  memoryStore.activeRepo = null;
  memoryStore.loading = false;
  memoryStore.saving = false;
  memoryStore.error = null;
});

describe('MemoryStore', () => {
  describe('filesByFolder', () => {
    it('groups files by folder', () => {
      memoryStore.files = [
        makeEntry({ folder: 'repo', relativePath: 'repo/a.md' }),
        makeEntry({ folder: 'repo', relativePath: 'repo/b.md' }),
        makeEntry({ folder: 'sessions', relativePath: 'sessions/s1.md' }),
      ];

      const grouped = memoryStore.filesByFolder;
      expect(Object.keys(grouped)).toEqual(['repo', 'sessions']);
      expect(grouped['repo']).toHaveLength(2);
      expect(grouped['sessions']).toHaveLength(1);
    });

    it('uses "." for files without folder', () => {
      memoryStore.files = [makeEntry({ folder: '' })];
      expect(memoryStore.filesByFolder['.']).toHaveLength(1);
    });

    it('returns empty object for no files', () => {
      expect(memoryStore.filesByFolder).toEqual({});
    });
  });

  describe('folders', () => {
    it('returns sorted folder names', () => {
      memoryStore.files = [
        makeEntry({ folder: 'sessions' }),
        makeEntry({ folder: 'architecture' }),
        makeEntry({ folder: 'repo' }),
      ];
      expect(memoryStore.folders).toEqual(['architecture', 'repo', 'sessions']);
    });
  });

  describe('loadForRepo()', () => {
    it('fetches files and updates state', async () => {
      const entries = [makeEntry()];
      mockGroveBench.memoryList.mockResolvedValue(entries);

      await memoryStore.loadForRepo('/repo/test');

      expect(mockGroveBench.memoryList).toHaveBeenCalledWith('/repo/test');
      expect(memoryStore.files).toEqual(entries);
      expect(memoryStore.activeRepo).toBe('/repo/test');
      expect(memoryStore.loading).toBe(false);
      expect(memoryStore.selectedFile).toBeNull();
    });

    it('sets error on failure', async () => {
      mockGroveBench.memoryList.mockRejectedValue(new Error('load failed'));

      await memoryStore.loadForRepo('/repo/test');

      expect(memoryStore.error).toBe('load failed');
      expect(memoryStore.loading).toBe(false);
    });
  });

  describe('readFile()', () => {
    it('reads file content and sets selectedFile', async () => {
      memoryStore.activeRepo = '/repo/test';
      mockGroveBench.memoryRead.mockResolvedValue('# Hello');

      await memoryStore.readFile('repo/overview.md');

      expect(mockGroveBench.memoryRead).toHaveBeenCalledWith('/repo/test', 'repo/overview.md');
      expect(memoryStore.selectedFile).toEqual({
        path: 'repo/overview.md',
        content: '# Hello',
      });
    });

    it('sets empty string when content is null', async () => {
      memoryStore.activeRepo = '/repo/test';
      mockGroveBench.memoryRead.mockResolvedValue(null);

      await memoryStore.readFile('missing.md');

      expect(memoryStore.selectedFile).toEqual({ path: 'missing.md', content: '' });
    });

    it('is a no-op without activeRepo', async () => {
      await memoryStore.readFile('repo/overview.md');
      expect(mockGroveBench.memoryRead).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      memoryStore.activeRepo = '/repo/test';
      mockGroveBench.memoryRead.mockRejectedValue(new Error('read failed'));

      await memoryStore.readFile('repo/overview.md');

      expect(memoryStore.error).toBe('read failed');
    });
  });

  describe('writeFile()', () => {
    it('writes content and refreshes file list', async () => {
      memoryStore.activeRepo = '/repo/test';
      memoryStore.selectedFile = { path: 'repo/overview.md', content: 'old' };
      mockGroveBench.memoryList.mockResolvedValue([makeEntry()]);

      await memoryStore.writeFile('repo/overview.md', 'new content');

      expect(mockGroveBench.memoryWrite).toHaveBeenCalledWith('/repo/test', 'repo/overview.md', 'new content');
      expect(memoryStore.selectedFile).toEqual({ path: 'repo/overview.md', content: 'new content' });
      expect(mockGroveBench.memoryList).toHaveBeenCalledWith('/repo/test');
      expect(memoryStore.saving).toBe(false);
    });

    it('does not update selectedFile if writing a different file', async () => {
      memoryStore.activeRepo = '/repo/test';
      memoryStore.selectedFile = { path: 'repo/other.md', content: 'keep' };
      mockGroveBench.memoryList.mockResolvedValue([]);

      await memoryStore.writeFile('repo/new.md', 'content');

      expect(memoryStore.selectedFile).toEqual({ path: 'repo/other.md', content: 'keep' });
    });

    it('is a no-op without activeRepo', async () => {
      await memoryStore.writeFile('repo/overview.md', 'content');
      expect(mockGroveBench.memoryWrite).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      memoryStore.activeRepo = '/repo/test';
      mockGroveBench.memoryWrite.mockRejectedValue(new Error('write failed'));

      await memoryStore.writeFile('repo/overview.md', 'content');

      expect(memoryStore.error).toBe('write failed');
      expect(memoryStore.saving).toBe(false);
    });
  });

  describe('deleteFile()', () => {
    it('deletes file and refreshes list', async () => {
      memoryStore.activeRepo = '/repo/test';
      memoryStore.selectedFile = { path: 'repo/overview.md', content: 'x' };
      mockGroveBench.memoryList.mockResolvedValue([]);

      await memoryStore.deleteFile('repo/overview.md');

      expect(mockGroveBench.memoryDelete).toHaveBeenCalledWith('/repo/test', 'repo/overview.md');
      expect(memoryStore.selectedFile).toBeNull();
      expect(mockGroveBench.memoryList).toHaveBeenCalled();
    });

    it('keeps selectedFile if deleting a different file', async () => {
      memoryStore.activeRepo = '/repo/test';
      memoryStore.selectedFile = { path: 'repo/keep.md', content: 'keep' };
      mockGroveBench.memoryList.mockResolvedValue([]);

      await memoryStore.deleteFile('repo/other.md');

      expect(memoryStore.selectedFile).toEqual({ path: 'repo/keep.md', content: 'keep' });
    });

    it('is a no-op without activeRepo', async () => {
      await memoryStore.deleteFile('repo/overview.md');
      expect(mockGroveBench.memoryDelete).not.toHaveBeenCalled();
    });

    it('sets error on failure', async () => {
      memoryStore.activeRepo = '/repo/test';
      mockGroveBench.memoryDelete.mockRejectedValue(new Error('delete failed'));

      await memoryStore.deleteFile('repo/overview.md');

      expect(memoryStore.error).toBe('delete failed');
    });
  });
});
