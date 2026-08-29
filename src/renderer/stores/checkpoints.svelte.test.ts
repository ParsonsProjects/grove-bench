import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { checkpointStore, FULL_THREAD_UUID } from './checkpoints.svelte.js';
import type { CheckpointListItem, DiffHistoryResult } from '../../shared/types.js';

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
  checkpointStore.diffBySession = {};
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

  it('getDiff returns null', () => {
    expect(checkpointStore.getDiff(SID)).toBeNull();
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
  it('stores selection and loads the per-turn diff by default', async () => {
    mockGroveBench.getTurnDiff.mockResolvedValueOnce('turn diff output');

    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    expect(checkpointStore.getSelected(SID)).toBe('uuid-2');
    expect(mockGroveBench.getTurnDiff).toHaveBeenCalledWith(SID, 'uuid-2');
    expect(mockGroveBench.getCheckpointDiff).not.toHaveBeenCalled();
    expect(checkpointStore.getDiff(SID)).toBe('turn diff output');
  });

  it('loads the since-checkpoint diff in since mode', async () => {
    await checkpointStore.setDiffMode(SID, 'since');
    mockGroveBench.getCheckpointDiff.mockResolvedValueOnce('since diff output');

    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    expect(mockGroveBench.getCheckpointDiff).toHaveBeenCalledWith(SID, 'uuid-2');
    expect(mockGroveBench.getTurnDiff).not.toHaveBeenCalled();
    expect(checkpointStore.getDiff(SID)).toBe('since diff output');
  });

  it('sets diff loading flag', async () => {
    let resolveDiff: (v: string) => void;
    mockGroveBench.getTurnDiff.mockReturnValueOnce(
      new Promise<string>((r) => { resolveDiff = r; })
    );

    const p = checkpointStore.selectCheckpoint(SID, 'uuid-1');
    expect(checkpointStore.isDiffLoading(SID)).toBe(true);

    resolveDiff!('diff');
    await p;
    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
  });

  it('handles diff load error gracefully', async () => {
    mockGroveBench.getTurnDiff.mockRejectedValueOnce(new Error('fail'));

    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
    expect(checkpointStore.getDiff(SID)).toBeNull();
  });

  it('discards a stale diff response after the selection changed', async () => {
    let resolveFirst: (v: string) => void;
    mockGroveBench.getTurnDiff.mockReturnValueOnce(
      new Promise<string>((r) => { resolveFirst = r; })
    );
    const p1 = checkpointStore.selectCheckpoint(SID, 'uuid-1');

    mockGroveBench.getTurnDiff.mockResolvedValueOnce('second diff');
    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    resolveFirst!('first diff');
    await p1;

    expect(checkpointStore.getSelected(SID)).toBe('uuid-2');
    expect(checkpointStore.getDiff(SID)).toBe('second diff');
  });
});

describe('selectFullThread()', () => {
  it('selects the full-thread sentinel and loads the cumulative diff', async () => {
    mockGroveBench.getFullThreadDiff.mockResolvedValueOnce('cumulative diff');

    await checkpointStore.selectFullThread(SID);

    expect(checkpointStore.getSelected(SID)).toBe(FULL_THREAD_UUID);
    expect(mockGroveBench.getFullThreadDiff).toHaveBeenCalledWith(SID);
    expect(mockGroveBench.getTurnDiff).not.toHaveBeenCalled();
    expect(checkpointStore.getDiff(SID)).toBe('cumulative diff');
  });
});

describe('setDiffMode()', () => {
  it('reloads the diff for the current checkpoint selection', async () => {
    mockGroveBench.getTurnDiff.mockResolvedValueOnce('turn diff');
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    mockGroveBench.getCheckpointDiff.mockResolvedValueOnce('since diff');
    await checkpointStore.setDiffMode(SID, 'since');

    expect(checkpointStore.getDiffMode(SID)).toBe('since');
    expect(mockGroveBench.getCheckpointDiff).toHaveBeenCalledWith(SID, 'uuid-1');
    expect(checkpointStore.getDiff(SID)).toBe('since diff');
  });

  it('is a no-op when the mode is unchanged', async () => {
    mockGroveBench.getTurnDiff.mockResolvedValueOnce('turn diff');
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');
    mockGroveBench.getTurnDiff.mockClear();

    await checkpointStore.setDiffMode(SID, 'turn');

    expect(mockGroveBench.getTurnDiff).not.toHaveBeenCalled();
  });

  it('does not reload while the full-thread diff is selected', async () => {
    mockGroveBench.getFullThreadDiff.mockResolvedValueOnce('cumulative diff');
    await checkpointStore.selectFullThread(SID);

    await checkpointStore.setDiffMode(SID, 'since');

    expect(checkpointStore.getDiffMode(SID)).toBe('since');
    expect(mockGroveBench.getCheckpointDiff).not.toHaveBeenCalled();
    expect(checkpointStore.getDiff(SID)).toBe('cumulative diff');
  });
});

describe('clearSelection()', () => {
  it('clears selected and diff', async () => {
    mockGroveBench.getTurnDiff.mockResolvedValueOnce('diff');
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    checkpointStore.clearSelection(SID);

    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getDiff(SID)).toBeNull();
    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
  });
});

describe('clear()', () => {
  it('removes all state for session', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getDiffHistory.mockResolvedValueOnce(MOCK_HISTORY);
    mockGroveBench.getTurnDiff.mockResolvedValueOnce('diff');

    await checkpointStore.refresh(SID);
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');
    await checkpointStore.setDiffMode(SID, 'since');

    checkpointStore.clear(SID);

    expect(checkpointStore.getCheckpoints(SID)).toEqual([]);
    expect(checkpointStore.isLoading(SID)).toBe(false);
    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getDiff(SID)).toBeNull();
    expect(checkpointStore.getHistory(SID)).toEqual(EMPTY_HISTORY);
    expect(checkpointStore.getDiffMode(SID)).toBe('turn');
  });
});
