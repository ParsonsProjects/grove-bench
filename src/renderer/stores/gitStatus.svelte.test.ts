import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { settingsStore } from './settings.svelte.js';
import type { GitStatusResult } from '../../shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Drop results a test queued but didn't use, so they can't reach the next
  // test (CI runs them in a random order). Each keeps its default.
  mockGroveBench.getGitStatus.mockReset();
  mockGroveBench.getDefaultBranch.mockReset();
  gitStatusStore.statusBySession = {};
});

describe('gitStatusStore — per-session refresh suppression', () => {
  it('suppresses refresh only for the suppressed session', async () => {
    gitStatusStore.suppressRefresh('A');

    await gitStatusStore.refresh('A');
    expect(mockGroveBench.getGitStatus).not.toHaveBeenCalled();

    // A different session is unaffected by A's suppression.
    await gitStatusStore.refresh('B');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('B', { scope: 'branch', base: 'main' });
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
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('C', { scope: 'branch', base: 'main' });
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
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('D', { scope: 'branch', base: 'main' });
  });

  it('clear() drops a session from the suppression set', async () => {
    gitStatusStore.suppressRefresh('F');
    gitStatusStore.clear('F');

    await gitStatusStore.refresh('F');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('F', { scope: 'branch', base: 'main' });
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
    // The default view looks up its base first: clear once the fetch is out.
    await vi.waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('gone', { scope: 'branch', base: 'main' }));
    gitStatusStore.clear('gone');
    slow.resolve(entry('x.ts'));
    await pending;
    expect(gitStatusStore.statusBySession).not.toHaveProperty('gone');
    expect(gitStatusStore.loadingBySession).not.toHaveProperty('gone');
  });
});

describe('gitStatusStore — default branch view', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const listed = (...ids: string[]) => {
    sessionStore.sessions = ids.map((id) => ({ id, branch: 'feat', repoPath: '/repo', status: 'running' })) as never;
  };
  let prBase: Record<string, string> = {};
  let savedBase = '';

  beforeEach(() => {
    prBase = {};
    gitStatusStore.setPrBaseSource((id) => prBase[id]);
    savedBase = settingsStore.current.defaultBaseBranch;
    settingsStore.current = { ...settingsStore.current, defaultBaseBranch: '' };
  });

  afterEach(() => {
    // Put back what these tests change: the others compare against the
    // default branch the store falls back to, and CI shuffles the order.
    settingsStore.current = { ...settingsStore.current, defaultBaseBranch: savedBase };
    gitStatusStore.setPrBaseSource(() => undefined);
    sessionStore.sessions = [];
    for (const id of ['fresh', 'picked', 'empty', 'pr', 'setting', 'chosen']) gitStatusStore.clear(id);
  });

  it('opens on the branch view, looking up the repo\'s default branch once', async () => {
    listed('fresh');
    const lookup = deferred<string>();
    mockGroveBench.getDefaultBranch.mockReturnValueOnce(lookup.promise);
    const first = gitStatusStore.refresh('fresh');
    gitStatusStore.scheduleRefresh('fresh', 0);
    await new Promise((r) => setTimeout(r, 5));
    lookup.resolve('develop');
    await first;
    await new Promise((r) => setTimeout(r, 5));

    expect(mockGroveBench.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.getDefaultBranch).toHaveBeenCalledWith('/repo');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('fresh', { scope: 'branch', base: 'develop' });
    expect(gitStatusStore.getScope('fresh')).toEqual({ scope: 'branch', base: 'develop', auto: true });
  });

  it('keeps a scope chosen while the base was being looked up', async () => {
    listed('picked');
    const lookup = deferred<string>();
    mockGroveBench.getDefaultBranch.mockReturnValueOnce(lookup.promise);
    const first = gitStatusStore.refresh('picked');
    await gitStatusStore.setScope('picked', 'working');
    lookup.resolve('main');
    await first;

    expect(gitStatusStore.getScope('picked')).toEqual({ scope: 'working', base: undefined });
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledWith('picked');
  });

  it('shows the uncommitted changes when there is no branch view to draw', async () => {
    mockGroveBench.getGitStatus
      .mockResolvedValueOnce({ entries: [], scopeError: 'No merge base with main' })
      .mockResolvedValueOnce({ entries: [{ filePath: 'new.ts', status: 'untracked', staged: false }] })
      .mockResolvedValueOnce({ entries: [{ filePath: 'new.ts', status: 'untracked', staged: false }] });
    await gitStatusStore.refresh('empty');

    expect(gitStatusStore.getScope('empty')).toEqual({ scope: 'working', base: 'main', auto: true });
    expect(gitStatusStore.getStatus('empty').entries.map((e) => e.filePath)).toEqual(['new.ts']);

    // The same base again: it stays on the uncommitted view without retrying.
    gitStatusStore.scheduleRefresh('empty', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('empty');
  });

  it('compares against the open PR\'s base, and follows it when it changes', async () => {
    prBase.pr = 'release/1.2';
    await gitStatusStore.refresh('pr');
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('pr', { scope: 'branch', base: 'release/1.2' });

    prBase.pr = 'main';
    gitStatusStore.prBaseChanged('pr');
    await new Promise((r) => setTimeout(r, 350));
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('pr', { scope: 'branch', base: 'main' });
  });

  it('picks up a new default base from Settings', async () => {
    await gitStatusStore.refresh('setting');
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('setting', { scope: 'branch', base: 'main' });

    settingsStore.current = { ...settingsStore.current, defaultBaseBranch: 'develop' };
    gitStatusStore.scheduleRefresh('setting', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('setting', { scope: 'branch', base: 'develop' });
  });

  it('leaves a scope the user picked alone', async () => {
    await gitStatusStore.setScope('chosen', 'branch', 'main');
    prBase.chosen = 'release/1.2';
    mockGroveBench.getGitStatus.mockResolvedValueOnce({ entries: [], scopeError: 'No merge base with main' });
    gitStatusStore.scheduleRefresh('chosen', 0);
    await new Promise((r) => setTimeout(r, 5));

    expect(gitStatusStore.getScope('chosen')).toEqual({ scope: 'branch', base: 'main' });
    expect(mockGroveBench.getGitStatus).toHaveBeenLastCalledWith('chosen', { scope: 'branch', base: 'main' });
  });
});

describe('gitStatusStore — revertFile', () => {
  it('refreshes the list even when the revert fails, as it may be half done', async () => {
    const refresh = vi.spyOn(gitStatusStore, 'scheduleRefresh').mockImplementation(() => {});
    mockGroveBench.revertFile.mockRejectedValueOnce(new Error('rm failed'));
    await expect(gitStatusStore.revertFile('s', 'b.ts', true, 'a.ts')).rejects.toThrow('rm failed');
    expect(mockGroveBench.revertFile).toHaveBeenCalledWith('s', 'b.ts', true, 'a.ts');
    expect(refresh).toHaveBeenCalledWith('s', 100);
    refresh.mockRestore();
  });
});

describe('gitStatusStore — clear', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it('drops a refresh still in flight, even once a new one has started', async () => {
    const id = 'cleared';
    const working = () => { gitStatusStore.scopeBySession = { ...gitStatusStore.scopeBySession, [id]: { scope: 'working' } }; };
    working();
    const stale = deferred<GitStatusResult>();
    mockGroveBench.getGitStatus.mockReturnValueOnce(stale.promise);
    const first = gitStatusStore.refresh(id);

    gitStatusStore.clear(id);
    working();
    mockGroveBench.getGitStatus.mockResolvedValueOnce({ entries: [] });
    await gitStatusStore.refresh(id);
    stale.resolve({ entries: [{ filePath: 'old.ts', status: 'modified', staged: false }] });
    await first;

    expect(gitStatusStore.statusBySession[id]?.entries).toEqual([]);
    gitStatusStore.clear(id);
  });
});

describe('gitStatusStore — continue or abort', () => {
  afterEach(() => gitStatusStore.clear('op'));

  it('reloads the status before it settles, in place of a refresh already scheduled', async () => {
    gitStatusStore.scopeBySession = { op: { scope: 'working' } };
    mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
    // The last file marked resolved scheduled one.
    gitStatusStore.scheduleRefresh('op', 100);
    await gitStatusStore.continueOperation('op', 'rebase');
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);

    // Left to run, it would start another, which could overtake this one.
    await new Promise((r) => setTimeout(r, 150));
    expect(mockGroveBench.getGitStatus).toHaveBeenCalledTimes(1);
  });
});
