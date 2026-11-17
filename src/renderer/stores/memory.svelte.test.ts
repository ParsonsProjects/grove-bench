import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { memoryStore } from './memory.svelte.js';
import type { MemoryCompactionPreview, MemoryCompactionStatus, MemoryCompactionStep, MemoryEntry } from '../../shared/types.js';

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
    expect(memoryStore.compactMessage).toBe('Deleted 2 thread notes');
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
    memoryStore.compactingRepo = '/repo';
    await memoryStore.cancelCompact();
    expect(mockGroveBench.memoryCompactCancel).toHaveBeenCalledWith('/repo');
    memoryStore.compacting = false;
    memoryStore.compactingRepo = null;
  });

  describe('after switching project mid-compaction', () => {
    function startOnA() {
      let finish!: (status: MemoryCompactionStatus) => void;
      mockGroveBench.memoryCompact.mockReturnValueOnce(new Promise<MemoryCompactionStatus>((r) => { finish = r; }));
      memoryStore.activeRepo = '/repo-a';
      const running = memoryStore.compact();
      memoryStore.activeRepo = '/repo-b'; // the panel now shows another project
      memoryStore.files = [entry('repo/b.md', 1)];
      return { running, finish };
    }

    it('cancels the project the compaction is running on', async () => {
      const { running, finish } = startOnA();
      await memoryStore.cancelCompact();
      expect(mockGroveBench.memoryCompactCancel).toHaveBeenCalledWith('/repo-a');
      finish({ compacted: false, skippedReason: 'cancelled', filesChanged: [] });
      await running;
    });

    it('shows its progress only for that project', async () => {
      const { running, finish } = startOnA();
      (memoryStore as any).handleCompactionEvent({ kind: 'stage', repoPath: '/repo-a', stage: 'planning' });
      expect(memoryStore.compactStage).toBe('planning');
      expect(memoryStore.compactingRepo).toBe('/repo-a');
      finish({ compacted: false, skippedReason: 'nothing to merge or describe', filesChanged: [] });
      await running;
      expect(memoryStore.compactingRepo).toBeNull();
    });

    it('undoes it in its own project and leaves the shown list alone', async () => {
      const { running, finish } = startOnA();
      finish({ compacted: true, backupId: 'bk-a', filesChanged: ['repo/a.md'] });
      await running;
      expect(mockGroveBench.memoryList).not.toHaveBeenCalled();
      expect(memoryStore.files.map((f) => f.relativePath)).toEqual(['repo/b.md']);

      mockGroveBench.memoryRestoreBackup.mockResolvedValueOnce({ restored: true, filesChanged: ['repo/a.md'] });
      await memoryStore.undoCompaction();
      expect(mockGroveBench.memoryRestoreBackup).toHaveBeenCalledWith('/repo-a', 'bk-a');
      expect(mockGroveBench.memoryList).not.toHaveBeenCalled();
    });
  });

  it('cancelCompact is a no-op when nothing is running', async () => {
    memoryStore.compacting = false;
    await memoryStore.cancelCompact();
    expect(mockGroveBench.memoryCompactCancel).not.toHaveBeenCalled();
  });

  it('tracks compaction stages and merge progress for the project being compacted', () => {
    memoryStore.compactingRepo = '/repo';
    (memoryStore as any).handleCompactionEvent({ kind: 'stage', repoPath: '/repo', stage: 'planning' });
    expect(memoryStore.compactStage).toBe('planning');
    expect(memoryStore.compactProgress).toBeNull();

    (memoryStore as any).handleCompactionEvent({ kind: 'stage', repoPath: '/repo', stage: 'merging', done: 2, total: 5 });
    expect(memoryStore.compactStage).toBe('merging');
    expect(memoryStore.compactProgress).toEqual({ done: 2, total: 5 });
    memoryStore.compactStage = null;
    memoryStore.compactProgress = null;

    // Stage events for a different repo are ignored
    (memoryStore as any).handleCompactionEvent({ kind: 'stage', repoPath: '/other', stage: 'merging', done: 1, total: 1 });
    expect(memoryStore.compactStage).toBeNull();
    memoryStore.compactingRepo = null;
  });

  describe('steps', () => {
    const step = (index: number, state: MemoryCompactionStep['state'], extra: Partial<MemoryCompactionStep> = {}): MemoryCompactionStep => ({
      index, label: index === 0 ? 'Planning' : `Merge ${index}`, state, model: 'haiku',
      systemPrompt: `prompt ${index}`, userMessage: 'JSON only', startedAt: 1000, inputBytes: 100, ...extra,
    });

    afterEach(() => {
      memoryStore.compactingRepo = null;
      memoryStore.compactSteps = [];
      memoryStore.compactStepsRepo = null;
    });

    it('lists each model call in order, replacing a step when it ends', () => {
      memoryStore.compactingRepo = '/repo';
      const event = (s: MemoryCompactionStep, repoPath = '/repo') =>
        (memoryStore as any).handleCompactionEvent({ kind: 'step', repoPath, step: s });

      event(step(0, 'running'));
      event(step(0, 'done', { durationMs: 4000, startupMs: 900 }));
      event(step(2, 'running'));
      event(step(1, 'running'));
      event(step(1, 'rejected', { detail: 'repo/a.md changed during the step' }));
      event(step(3, 'running'), '/other');

      expect(memoryStore.compactSteps.map((s) => [s.index, s.state])).toEqual([[0, 'done'], [1, 'rejected'], [2, 'running']]);
      expect(memoryStore.compactSteps[0].startupMs).toBe(900);
    });

    it('starts a run with no steps, kept for its project after it ends', async () => {
      memoryStore.activeRepo = '/repo';
      memoryStore.compactSteps = [step(0, 'done')];
      memoryStore.compactStepsRepo = '/old';
      let finish!: (s: MemoryCompactionStatus) => void;
      mockGroveBench.memoryCompact.mockReturnValueOnce(new Promise<MemoryCompactionStatus>((r) => { finish = r; }));

      const running = memoryStore.compact();
      expect(memoryStore.compactSteps).toEqual([]);
      expect(memoryStore.compactStepsRepo).toBe('/repo');
      (memoryStore as any).handleCompactionEvent({ kind: 'step', repoPath: '/repo', step: step(0, 'done') });
      finish({ compacted: false, skippedReason: 'nothing to merge or describe', filesChanged: [] });
      await running;

      expect(memoryStore.compactSteps).toHaveLength(1);
      expect(memoryStore.compactStepsRepo).toBe('/repo');
    });
  });

  describe('confirm dialog', () => {
    const preview: MemoryCompactionPreview = {
      agentId: 'claude-work', agentName: 'Claude (work)', model: 'haiku', fileCount: 2, totalBytes: 900,
      maxGroups: 6, parallelMerges: 3, plan: { systemPrompt: 'You are planning', userMessage: 'Plan the clean-up.' },
    };

    afterEach(() => memoryStore.closeCompactPreview());

    it('loads what the run would use without starting it', async () => {
      memoryStore.activeRepo = '/repo';
      mockGroveBench.memoryCompactPreview.mockResolvedValueOnce(preview);

      await memoryStore.openCompactPreview();

      expect(mockGroveBench.memoryCompactPreview).toHaveBeenCalledWith('/repo');
      expect(memoryStore.compactPreview).toEqual(preview);
      expect(mockGroveBench.memoryCompact).not.toHaveBeenCalled();
    });

    it('drops a preview for a project the panel has left', async () => {
      memoryStore.activeRepo = '/repo-a';
      let answer!: (p: MemoryCompactionPreview) => void;
      mockGroveBench.memoryCompactPreview.mockReturnValueOnce(new Promise<MemoryCompactionPreview>((r) => { answer = r; }));

      const opening = memoryStore.openCompactPreview();
      memoryStore.activeRepo = '/repo-b';
      answer(preview);
      await opening;

      expect(memoryStore.compactPreview).toBeNull();
    });

    it('runs on the agent it showed, with the model picked for this run', async () => {
      memoryStore.activeRepo = '/repo';
      mockGroveBench.memoryCompactPreview.mockResolvedValueOnce(preview);
      await memoryStore.openCompactPreview();

      await memoryStore.compact('claude-sonnet-4-5');

      expect(mockGroveBench.memoryCompact).toHaveBeenCalledWith('/repo', { agentId: 'claude-work', model: 'claude-sonnet-4-5' });
      expect(memoryStore.compactPreview).toBeNull();
    });

    it("sends no model when Default is kept, so the run uses the preview's", async () => {
      memoryStore.activeRepo = '/repo';
      mockGroveBench.memoryCompactPreview.mockResolvedValueOnce(preview);
      await memoryStore.openCompactPreview();

      await memoryStore.compact();

      expect(mockGroveBench.memoryCompact).toHaveBeenCalledWith('/repo', { agentId: 'claude-work' });
    });
  });

  it('undoCompaction restores the recorded snapshot and clears the result', async () => {
    mockGroveBench.memoryCompact.mockResolvedValueOnce({
      compacted: true, filesChanged: ['repo/a.md'], backupId: 'snap-1',
    });
    await memoryStore.compact();
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
    expect(mockGroveBench.memoryReadBackupFile).toHaveBeenCalledWith('/repo', 'snap-1', 'repo/a.md');
    expect(memoryStore.backupPreviewFile).toEqual({ path: 'repo/a.md', content: 'archived content' });
  });

  it('shows a snapshot file it cannot read as unreadable', async () => {
    mockGroveBench.memoryReadBackupFile.mockResolvedValueOnce(null);
    await memoryStore.readBackupFile('snap-1', 'repo/a.md');
    expect(memoryStore.backupPreviewFile).toEqual({ path: 'repo/a.md', content: '(unreadable)' });
  });
});
