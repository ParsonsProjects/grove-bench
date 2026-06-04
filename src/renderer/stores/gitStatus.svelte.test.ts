import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { gitStatusStore } from './gitStatus.svelte.js';

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
