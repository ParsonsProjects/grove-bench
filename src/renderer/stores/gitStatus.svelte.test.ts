import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import type { GitStatusResult } from '../../shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  gitStatusStore.statusBySession = {};
});

describe('gitStatusStore — per-session refresh suppression', () => {
  it('suppresses refresh only for the suppressed session', async () => {
    gitStatusStore.suppressRefresh('A');

    await gitStatusStore.refresh('A');
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();

    // A different session is unaffected by A's suppression.
    await gitStatusStore.refresh('B');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('B');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);
  });

  it('checks for a branch switch alongside the status, but not while suppressed', async () => {
    gitStatusStore.suppressRefresh('branch-sync');
    await gitStatusStore.refresh('branch-sync');
    expect(mockGroveBench.syncBranch).not.toHaveBeenCalled();

    gitStatusStore.unsuppressRefresh('branch-sync');
    await gitStatusStore.refresh('branch-sync');
    expect(mockGroveBench.syncBranch).toHaveBeenCalledWith('branch-sync');
  });

  it('resumes refreshing after unsuppress', async () => {
    gitStatusStore.suppressRefresh('C');
    gitStatusStore.unsuppressRefresh('C');

    await gitStatusStore.refresh('C');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('C');
  });

  it('concurrent suppression of one session does not leak to another', async () => {
    // Models the startup race: two panes suppress independently; ending one
    // must not un-suppress the other.
    gitStatusStore.suppressRefresh('D');
    gitStatusStore.suppressRefresh('E');
    gitStatusStore.unsuppressRefresh('D'); // D's pane finished replay first

    await gitStatusStore.refresh('E');
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled(); // E still suppressed

    await gitStatusStore.refresh('D');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('D');
  });

  it('clear() drops a session from the suppression set', async () => {
    gitStatusStore.suppressRefresh('F');
    gitStatusStore.clear('F');

    await gitStatusStore.refresh('F');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('F');
  });
});

describe('gitStatusStore — overlapping refreshes', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const entry = (filePath: string): GitStatusResult => ({ entries: [{ filePath, status: 'modified', staged: false }] });

  it('keeps the newer scope\'s result when an older, slower one lands after it', async () => {
    const slowBranch = deferred<GitStatusResult>();
    mockGroveBench.getGitStatus
      .mockReturnValueOnce(slowBranch.promise)
      .mockResolvedValueOnce(entry('uncommitted.ts'));

    const branch = gitStatusStore.setScope('race', 'branch', 'main');
    await gitStatusStore.setScope('race', 'working');
    expect(gitStatusStore.getStatus('race').entries[0].filePath).toBe('uncommitted.ts');
    expect(gitStatusStore.isLoading('race')).toBe(false);

    slowBranch.resolve(entry('committed-on-branch.ts'));
    await branch;
    expect(gitStatusStore.getStatus('race').entries[0].filePath).toBe('uncommitted.ts');
    gitStatusStore.clear('race');
  });

  it('drops a result for a conversation cleared while it was loading', async () => {
    const slow = deferred<GitStatusResult>();
    mockGroveBench.getGitStatus.mockReturnValueOnce(slow.promise);
    const pending = gitStatusStore.refresh('gone');
    gitStatusStore.clear('gone');
    slow.resolve(entry('x.ts'));
    await pending;
    expect(gitStatusStore.statusBySession).not.toHaveProperty('gone');
    expect(gitStatusStore.loadingBySession).not.toHaveProperty('gone');
  });
});
