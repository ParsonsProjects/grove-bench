import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { checkpointStore, FULL_THREAD_UUID } from './checkpoints.svelte.js';
import type { CheckpointListItem, DiffHistoryResult, GitStatusResult } from '../../shared/types.js';

const files = (...paths: string[]): GitStatusResult => ({ entries: paths.map(p => ({ filePath: p, status: 'modified' as const, staged: false })) });

const SID = 'test-session';

const MOCK_CHECKPOINTS: CheckpointListItem[] = [
  { uuid: 'uuid-3', turn: 3, ref: 'refs/grove/checkpoints/s/turn/3' },
  { uuid: 'uuid-2', turn: 2, ref: 'refs/grove/checkpoints/s/turn/2' },
  { uuid: 'uuid-1', turn: 1, ref: 'refs/grove/checkpoints/s/turn/1' },
];

const MOCK_HISTORY: DiffHistoryResult = {
  entries: [
    { uuid: 'uuid-3', turn: 3, filesChanged: 1, additions: 5, deletions: 1 },
    { uuid: 'uuid-2', turn: 2, filesChanged: 2, additions: 10, deletions: 3 },
    { uuid: 'uuid-1', turn: 1, filesChanged: 0, additions: 0, deletions: 0 },
  ],
  total: { filesChanged: 3, additions: 15, deletions: 4 },
};

const EMPTY_HISTORY: DiffHistoryResult = {
  entries: [],
  total: { filesChanged: 0, additions: 0, deletions: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  // clear() resets both public state and private throttle/timeout maps
  checkpointStore.clear(SID);
  checkpointStore.checkpointsBySession = {};
  checkpointStore.loadingBySession = {};
  checkpointStore.selectedBySession = {};
  checkpointStore.filesBySession = {};
  checkpointStore.diffLoadingBySession = {};
  checkpointStore.historyBySession = {};
  checkpointStore.diffModeBySession = {};
});

describe('initial state', () => {
  it('getCheckpoints returns empty array', () => {
    expect(checkpointStore.getCheckpoints(SID)).toEqual([]);
  });

  it('isLoading returns false', () => {
    expect(checkpointStore.isLoading(SID)).toBe(false);
  });

  it('getSelected returns null', () => {
    expect(checkpointStore.getSelected(SID)).toBeNull();
  });

  it('getFiles returns null', () => {
    expect(checkpointStore.getFiles(SID)).toBeNull();
  });

  it('getHistory returns empty result', () => {
    expect(checkpointStore.getHistory(SID)).toEqual(EMPTY_HISTORY);
  });

  it('getDiffMode defaults to turn', () => {
    expect(checkpointStore.getDiffMode(SID)).toBe('turn');
  });
});

describe('refresh()', () => {
  it('calls listCheckpoints and getDiffHistory IPC and stores results', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getDiffHistory.mockResolvedValueOnce(MOCK_HISTORY);

    await checkpointStore.refresh(SID);

    expect(mockGroveBench.listCheckpoints).toHaveBeenCalledWith(SID);
    expect(mockGroveBench.getDiffHistory).toHaveBeenCalledWith(SID);
    expect(checkpointStore.getCheckpoints(SID)).toEqual(MOCK_CHECKPOINTS);
    expect(checkpointStore.getHistory(SID)).toEqual(MOCK_HISTORY);
  });

  it('sets loading flag during fetch', async () => {
    let resolveIpc: (v: CheckpointListItem[]) => void;
    mockGroveBench.listCheckpoints.mockReturnValueOnce(
      new Promise<CheckpointListItem[]>((r) => { resolveIpc = r; })
    );

    const p = checkpointStore.refresh(SID);
    expect(checkpointStore.isLoading(SID)).toBe(true);

    resolveIpc!(MOCK_CHECKPOINTS);
    await p;
    expect(checkpointStore.isLoading(SID)).toBe(false);
  });

  it('handles IPC errors gracefully', async () => {
    mockGroveBench.listCheckpoints.mockRejectedValueOnce(new Error('fail'));

    await checkpointStore.refresh(SID);

    // Should not throw, loading should be cleared
    expect(checkpointStore.isLoading(SID)).toBe(false);
    expect(checkpointStore.getCheckpoints(SID)).toEqual([]);
  });

  it('still stores checkpoints when only the history fetch fails', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getDiffHistory.mockRejectedValueOnce(new Error('fail'));

    await checkpointStore.refresh(SID);

    expect(checkpointStore.getCheckpoints(SID)).toEqual(MOCK_CHECKPOINTS);
    expect(checkpointStore.getHistory(SID)).toEqual(EMPTY_HISTORY);
  });
});

describe('getHistoryEntry()', () => {
  it('finds the stats entry for a uuid', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getDiffHistory.mockResolvedValueOnce(MOCK_HISTORY);
    await checkpointStore.refresh(SID);

    expect(checkpointStore.getHistoryEntry(SID, 'uuid-2')).toEqual(MOCK_HISTORY.entries[1]);
    expect(checkpointStore.getHistoryEntry(SID, 'nope')).toBeUndefined();
  });
});

describe('selectCheckpoint()', () => {
  it('stores selection and loads the per-turn file list by default', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('a.ts'));

    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    expect(checkpointStore.getSelected(SID)).toBe('uuid-2');
    expect(mockGroveBench.getCheckpointFiles).toHaveBeenCalledWith(SID, 'uuid-2', 'turn');
    expect(checkpointStore.getFiles(SID)).toEqual(files('a.ts'));
    expect(checkpointStore.getSourceKey(SID)).toBe('cp:uuid-2:turn');
  });

  it('loads the since-checkpoint file list in since mode', async () => {
    await checkpointStore.setDiffMode(SID, 'since');
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('b.ts'));

    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    expect(mockGroveBench.getCheckpointFiles).toHaveBeenCalledWith(SID, 'uuid-2', 'since');
    expect(checkpointStore.getFiles(SID)).toEqual(files('b.ts'));
  });

  it('sets diff loading flag', async () => {
    let resolveFiles: (v: GitStatusResult) => void;
    mockGroveBench.getCheckpointFiles.mockReturnValueOnce(
      new Promise<GitStatusResult>((r) => { resolveFiles = r; })
    );

    const p = checkpointStore.selectCheckpoint(SID, 'uuid-1');
    expect(checkpointStore.isDiffLoading(SID)).toBe(true);

    resolveFiles!(files());
    await p;
    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
  });

  it('handles a load error by surfacing a scope error', async () => {
    mockGroveBench.getCheckpointFiles.mockRejectedValueOnce(new Error('fail'));

    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
    expect(checkpointStore.getFiles(SID)?.entries).toEqual([]);
    expect(checkpointStore.getFiles(SID)?.scopeError).toBeTruthy();
  });

  it('discards a stale response after the selection changed', async () => {
    let resolveFirst: (v: GitStatusResult) => void;
    mockGroveBench.getCheckpointFiles.mockReturnValueOnce(
      new Promise<GitStatusResult>((r) => { resolveFirst = r; })
    );
    const p1 = checkpointStore.selectCheckpoint(SID, 'uuid-1');

    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('second.ts'));
    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    resolveFirst!(files('first.ts'));
    await p1;

    expect(checkpointStore.getSelected(SID)).toBe('uuid-2');
    expect(checkpointStore.getFiles(SID)).toEqual(files('second.ts'));
  });

  it('routes per-file diff and line requests to the selected comparison', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('a.ts'));
    await checkpointStore.selectCheckpoint(SID, 'uuid-2');
    const entry = files('a.ts').entries[0];

    await checkpointStore.loadFileDiff(SID, entry);
    await checkpointStore.loadFileLines(SID, entry);

    expect(mockGroveBench.getCheckpointFileDiff).toHaveBeenCalledWith(SID, 'uuid-2', 'turn', 'a.ts');
    expect(mockGroveBench.getCheckpointFileLines).toHaveBeenCalledWith(SID, 'uuid-2', 'turn', 'a.ts');
  });
});

describe('selectFullThread()', () => {
  it('selects the full-thread sentinel and loads the cumulative file list', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('all.ts'));

    await checkpointStore.selectFullThread(SID);

    expect(checkpointStore.getSelected(SID)).toBe(FULL_THREAD_UUID);
    expect(mockGroveBench.getCheckpointFiles).toHaveBeenCalledWith(SID, FULL_THREAD_UUID, 'full');
    expect(checkpointStore.getFiles(SID)).toEqual(files('all.ts'));
    expect(checkpointStore.getScope(SID)).toBe('full');
  });
});

describe('setDiffMode()', () => {
  it('reloads the file list for the current checkpoint selection', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('turn.ts'));
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('since.ts'));
    await checkpointStore.setDiffMode(SID, 'since');

    expect(checkpointStore.getDiffMode(SID)).toBe('since');
    expect(mockGroveBench.getCheckpointFiles).toHaveBeenLastCalledWith(SID, 'uuid-1', 'since');
    expect(checkpointStore.getFiles(SID)).toEqual(files('since.ts'));
  });

  it('is a no-op when the mode is unchanged', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files());
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');
    mockGroveBench.getCheckpointFiles.mockClear();

    await checkpointStore.setDiffMode(SID, 'turn');

    expect(mockGroveBench.getCheckpointFiles).not.toHaveBeenCalled();
  });

  it('does not reload while the full-thread diff is selected', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('all.ts'));
    await checkpointStore.selectFullThread(SID);
    mockGroveBench.getCheckpointFiles.mockClear();

    await checkpointStore.setDiffMode(SID, 'since');

    expect(checkpointStore.getDiffMode(SID)).toBe('since');
    expect(mockGroveBench.getCheckpointFiles).not.toHaveBeenCalled();
    expect(checkpointStore.getFiles(SID)).toEqual(files('all.ts'));
  });
});

describe('clearSelection()', () => {
  it('clears selected and files', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValueOnce(files('a.ts'));
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    checkpointStore.clearSelection(SID);

    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getFiles(SID)).toBeNull();
    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
  });
});

describe('clear()', () => {
  it('removes all state for session', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getDiffHistory.mockResolvedValueOnce(MOCK_HISTORY);
    mockGroveBench.getCheckpointFiles.mockResolvedValue(files('a.ts'));

    await checkpointStore.refresh(SID);
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');
    await checkpointStore.setDiffMode(SID, 'since');

    checkpointStore.clear(SID);

    expect(checkpointStore.getCheckpoints(SID)).toEqual([]);
    expect(checkpointStore.isLoading(SID)).toBe(false);
    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getFiles(SID)).toBeNull();
    expect(checkpointStore.getHistory(SID)).toEqual(EMPTY_HISTORY);
    expect(checkpointStore.getDiffMode(SID)).toBe('turn');
  });
});
