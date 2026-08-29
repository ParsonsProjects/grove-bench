import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { memoryStore } from './memory.svelte.js';
import type { MemoryEntry } from '../../shared/types.js';

const DAY = 86_400_000;

function entry(relativePath: string, ageDays: number | null): MemoryEntry {
  return {
    relativePath,
    title: relativePath.split('/').pop()!.replace('.md', ''),
    updatedAt: ageDays === null ? '' : new Date(Date.now() - ageDays * DAY).toISOString(),
    folder: relativePath.split('/')[0],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryStore.files = [];
  memoryStore.selectedFile = null;
  memoryStore.activeRepo = '/repo';
  memoryStore.error = null;
  memoryStore.compactMessage = null;
});

describe('sessionNotesOlderThan', () => {
  it('returns only session notes past the cutoff, oldest first', () => {
    memoryStore.files = [
      entry('sessions/recent.md', 5),
      entry('sessions/old.md', 60),
      entry('sessions/ancient.md', 200),
      entry('repo/overview.md', 300), // non-session, never included
    ];

    const result = memoryStore.sessionNotesOlderThan(30);

    expect(result.map(n => n.relativePath)).toEqual(['sessions/ancient.md', 'sessions/old.md']);
  });

  it('includes notes with unparseable timestamps, listed first', () => {
    memoryStore.files = [
      entry('sessions/old.md', 60),
      entry('sessions/undated.md', null),
    ];

    const result = memoryStore.sessionNotesOlderThan(30);

    expect(result.map(n => n.relativePath)).toEqual(['sessions/undated.md', 'sessions/old.md']);
    expect(result[0].ts).toBe(0);
  });

  it('returns an empty list when nothing is old enough', () => {
    memoryStore.files = [entry('sessions/recent.md', 2)];
    expect(memoryStore.sessionNotesOlderThan(30)).toEqual([]);
  });
});

describe('deleteFiles', () => {
  it('deletes each path, refreshes the list, and reports a message', async () => {
    const remaining = [entry('sessions/kept.md', 1)];
    mockGroveBench.memoryList.mockResolvedValueOnce(remaining);

    await memoryStore.deleteFiles(['sessions/a.md', 'sessions/b.md']);

    expect(mockGroveBench.memoryDelete).toHaveBeenCalledTimes(2);
    expect(mockGroveBench.memoryDelete).toHaveBeenCalledWith('/repo', 'sessions/a.md');
    expect(mockGroveBench.memoryDelete).toHaveBeenCalledWith('/repo', 'sessions/b.md');
    expect(memoryStore.files).toEqual(remaining);
    expect(memoryStore.compactMessage).toBe('Deleted 2 session notes');
  });

  it('clears the selected file when it was among those deleted', async () => {
    memoryStore.selectedFile = { path: 'sessions/a.md', content: 'x' };
    await memoryStore.deleteFiles(['sessions/a.md']);
    expect(memoryStore.selectedFile).toBeNull();
  });

  it('does nothing for an empty list', async () => {
    await memoryStore.deleteFiles([]);
    expect(mockGroveBench.memoryDelete).not.toHaveBeenCalled();
    expect(mockGroveBench.memoryList).not.toHaveBeenCalled();
  });

  it('surfaces IPC errors', async () => {
    mockGroveBench.memoryDelete.mockRejectedValueOnce(new Error('disk gone'));
    await memoryStore.deleteFiles(['sessions/a.md']);
    expect(memoryStore.error).toBe('disk gone');
  });
});
