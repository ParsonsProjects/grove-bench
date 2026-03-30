import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { checkpointStore } from './checkpoints.svelte.js';
import type { CheckpointListItem } from '../../shared/types.js';

const SID = 'test-session';

const MOCK_CHECKPOINTS: CheckpointListItem[] = [
  { uuid: 'uuid-3', turn: 3, ref: 'refs/grove/checkpoints/s/turn/3' },
  { uuid: 'uuid-2', turn: 2, ref: 'refs/grove/checkpoints/s/turn/2' },
  { uuid: 'uuid-1', turn: 1, ref: 'refs/grove/checkpoints/s/turn/1' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // clear() resets both public state and private throttle/timeout maps
  checkpointStore.clear(SID);
  checkpointStore.checkpointsBySession = {};
  checkpointStore.loadingBySession = {};
  checkpointStore.selectedBySession = {};
  checkpointStore.diffBySession = {};
  checkpointStore.diffLoadingBySession = {};
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
});

describe('refresh()', () => {
  it('calls listCheckpoints IPC and stores result', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);

    await checkpointStore.refresh(SID);

    expect(mockGroveBench.listCheckpoints).toHaveBeenCalledWith(SID);
    expect(checkpointStore.getCheckpoints(SID)).toEqual(MOCK_CHECKPOINTS);
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
});

describe('selectCheckpoint()', () => {
  it('stores selection and loads diff', async () => {
    mockGroveBench.getCheckpointDiff.mockResolvedValueOnce('diff output');

    await checkpointStore.selectCheckpoint(SID, 'uuid-2');

    expect(checkpointStore.getSelected(SID)).toBe('uuid-2');
    expect(mockGroveBench.getCheckpointDiff).toHaveBeenCalledWith(SID, 'uuid-2');
    expect(checkpointStore.getDiff(SID)).toBe('diff output');
  });

  it('sets diff loading flag', async () => {
    let resolveDiff: (v: string) => void;
    mockGroveBench.getCheckpointDiff.mockReturnValueOnce(
      new Promise<string>((r) => { resolveDiff = r; })
    );

    const p = checkpointStore.selectCheckpoint(SID, 'uuid-1');
    expect(checkpointStore.isDiffLoading(SID)).toBe(true);

    resolveDiff!('diff');
    await p;
    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
  });

  it('handles diff load error gracefully', async () => {
    mockGroveBench.getCheckpointDiff.mockRejectedValueOnce(new Error('fail'));

    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    expect(checkpointStore.isDiffLoading(SID)).toBe(false);
    expect(checkpointStore.getDiff(SID)).toBeNull();
  });
});

describe('clearSelection()', () => {
  it('clears selected and diff', async () => {
    mockGroveBench.getCheckpointDiff.mockResolvedValueOnce('diff');
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    checkpointStore.clearSelection(SID);

    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getDiff(SID)).toBeNull();
  });
});

describe('clear()', () => {
  it('removes all state for session', async () => {
    mockGroveBench.listCheckpoints.mockResolvedValueOnce(MOCK_CHECKPOINTS);
    mockGroveBench.getCheckpointDiff.mockResolvedValueOnce('diff');

    await checkpointStore.refresh(SID);
    await checkpointStore.selectCheckpoint(SID, 'uuid-1');

    checkpointStore.clear(SID);

    expect(checkpointStore.getCheckpoints(SID)).toEqual([]);
    expect(checkpointStore.isLoading(SID)).toBe(false);
    expect(checkpointStore.getSelected(SID)).toBeNull();
    expect(checkpointStore.getDiff(SID)).toBeNull();
  });
});
