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
  memoryStore.lastCompaction = null;
  memoryStore.backupPreviewId = null;
  memoryStore.backupPreviewFiles = [];
  memoryStore.backupPreviewFile = null;
  memoryStore.panelOpen = true;
  memoryStore.toast = null;
  memoryStore.autoCompactingRepo = null;
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

describe('compact result and undo', () => {
  it('stores the compaction result for the summary dialog when files changed', async () => {
    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: true,
      filesChanged: ['repo/a.md', 'repo/b.md'],
      changes: [{ action: 'delete', path: 'repo/b.md', reason: 'merged into a' }],
      backupId: 'snap-1',
    });

    await memoryStore.compact();

    expect(memoryStore.lastCompaction?.backupId).toBe('snap-1');
    expect(memoryStore.compactMessage).toBeNull();
  });

  it('shows a message instead of the dialog when nothing was compacted', async () => {
    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: false, skippedReason: 'below threshold', filesChanged: [],
    });

    await memoryStore.compact();

    expect(memoryStore.lastCompaction).toBeNull();
    expect(memoryStore.compactMessage).toContain('below threshold');
  });

  it('shows an error, not "Nothing to compact", when the pass failed', async () => {
    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: false, error: 'compaction timed out after 300s', filesChanged: [],
    });

    await memoryStore.compact();

    expect(memoryStore.lastCompaction).toBeNull();
    expect(memoryStore.compactMessage).toBeNull();
    expect(memoryStore.error).toContain('timed out');
  });

  it('reports a cancelled pass as "Compaction cancelled", not as nothing-to-compact', async () => {
    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: false, skippedReason: 'cancelled', filesChanged: [],
    });

    await memoryStore.compact();

    expect(memoryStore.compactMessage).toBe('Compaction cancelled');
    expect(memoryStore.error).toBeNull();
  });

  it('routes skip and failure feedback to a toast when the panel is closed', async () => {
    memoryStore.panelOpen = false;

    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: false, skippedReason: 'below threshold', filesChanged: [],
    });
    await memoryStore.compact();
    expect(memoryStore.compactMessage).toBeNull();
    expect(memoryStore.toast?.kind).toBe('info');
    expect(memoryStore.toast?.message).toContain('below threshold');

    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: false, error: 'compaction timed out after 300s', filesChanged: [],
    });
    await memoryStore.compact();
    expect(memoryStore.error).toBeNull();
    expect(memoryStore.toast?.kind).toBe('error');
    expect(memoryStore.toast?.message).toContain('timed out');
  });

  it('cancelCompact forwards to the main process while a pass is running', async () => {
    memoryStore.compacting = true;
    await memoryStore.cancelCompact();
    expect(mockGroveBench.memoryCompactCancel).toHaveBeenCalledWith('/repo');
    memoryStore.compacting = false;
  });

  it('cancelCompact is a no-op when nothing is running', async () => {
    memoryStore.compacting = false;
    await memoryStore.cancelCompact();
    expect(mockGroveBench.memoryCompactCancel).not.toHaveBeenCalled();
  });

  it('surfaces an auto-compaction completion as a success toast with a View action', () => {
    (memoryStore as any).handleCompactionEvent({
      kind: 'stage', repoPath: '/repo', auto: true, stage: 'generating',
    });
    expect(memoryStore.autoCompactingRepo).toBe('/repo');

    (memoryStore as any).handleCompactionEvent({
      kind: 'done', repoPath: '/repo', auto: true,
      status: { compacted: true, filesChanged: ['repo/a.md', 'repo/b.md'] },
    });
    expect(memoryStore.autoCompactingRepo).toBeNull();
    expect(memoryStore.toast?.kind).toBe('success');
    expect(memoryStore.toast?.message).toContain('2 files');
    expect(memoryStore.toast?.showView).toBe(true);
  });

  it('stays silent when an auto pass finishes without compacting', () => {
    (memoryStore as any).handleCompactionEvent({
      kind: 'done', repoPath: '/repo', auto: true,
      status: { compacted: false, skippedReason: 'cooldown', filesChanged: [] },
    });
    expect(memoryStore.toast).toBeNull();
  });

  it('tracks manual compaction stages for the active repo', () => {
    (memoryStore as any).handleCompactionEvent({
      kind: 'stage', repoPath: '/repo', auto: false, stage: 'generating',
    });
    expect(memoryStore.compactStage).toBe('generating');
    memoryStore.compactStage = null;

    // Stage events for a different repo are ignored
    (memoryStore as any).handleCompactionEvent({
      kind: 'stage', repoPath: '/other', auto: false, stage: 'applying',
    });
    expect(memoryStore.compactStage).toBeNull();
  });

  it('undoCompaction restores the recorded snapshot and clears the result', async () => {
    memoryStore.lastCompaction = {
      compacted: true, filesChanged: ['repo/a.md'], backupId: 'snap-1',
    };
    mockGroveBench.memoryRestoreBackup.mockResolvedValueOnce({ restored: true, filesChanged: ['repo/a.md'] });

    await memoryStore.undoCompaction();

    expect(mockGroveBench.memoryRestoreBackup).toHaveBeenCalledWith('/repo', 'snap-1');
    expect(memoryStore.lastCompaction).toBeNull();
    expect(memoryStore.compactMessage).toBe('Compaction undone');
  });

  it('undoCompaction is a no-op without a backupId', async () => {
    memoryStore.lastCompaction = { compacted: true, filesChanged: [] };
    await memoryStore.undoCompaction();
    expect(mockGroveBench.memoryRestoreBackup).not.toHaveBeenCalled();
  });
});

describe('backup preview', () => {
  it('loads a snapshot file list and toggles off on second call', async () => {
    mockGroveBench.memoryBackupPreview.mockResolvedValue([{ path: 'repo/a.md', bytes: 100 }]);

    await memoryStore.previewBackup('snap-1');
    expect(memoryStore.backupPreviewId).toBe('snap-1');
    expect(memoryStore.backupPreviewFiles).toHaveLength(1);

    await memoryStore.previewBackup('snap-1');
    expect(memoryStore.backupPreviewId).toBeNull();
    expect(memoryStore.backupPreviewFiles).toEqual([]);
  });

  it('reads a single snapshot file for display', async () => {
    mockGroveBench.memoryReadBackupFile.mockResolvedValueOnce('archived content');
    await memoryStore.readBackupFile('snap-1', 'repo/a.md');
    expect(memoryStore.backupPreviewFile).toEqual({ path: 'repo/a.md', content: 'archived content' });
  });
});
