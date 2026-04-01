import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { store } from '../stores/sessions.svelte.js';
import { restoreWorktrees } from './restore-worktrees.js';

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [];
  store.activeSessionId = null;
  store.error = null;
  store.repos = [];
});

describe('restoreWorktrees', () => {
  it('does not remove repo when validateRepo throws', async () => {
    store.repos = ['/repo/a', '/repo/b'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.validateRepo
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(true);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([]);

    await restoreWorktrees();

    expect(store.repos).toContain('/repo/a');
    expect(store.repos).toContain('/repo/b');
  });

  it('does not remove repo when listWorktrees throws', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.validateRepo.mockResolvedValueOnce(true);
    mockGroveBench.listWorktrees.mockRejectedValueOnce(new Error('git error'));

    await restoreWorktrees();

    expect(store.repos).toContain('/repo/a');
  });

  it('does not remove repo when listSessions throws', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockRejectedValueOnce(new Error('IPC failure'));

    await expect(restoreWorktrees()).rejects.toThrow('IPC failure');

    expect(store.repos).toContain('/repo/a');
  });

  it('keeps repo when validateRepo returns false (e.g. git not in PATH)', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.validateRepo.mockResolvedValueOnce(false);

    await restoreWorktrees();

    expect(store.repos).toContain('/repo/a');
    expect(mockGroveBench.listWorktrees).not.toHaveBeenCalled();
  });

  it('restores worktree sessions from valid repos', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.validateRepo.mockResolvedValueOnce(true);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      { id: 'wt1', branch: 'feat/test', direct: false },
    ]);

    await restoreWorktrees();

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe('wt1');
    expect(store.sessions[0].status).toBe('stopped');
  });

  it('marks session as running when it has a running session', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([
      { id: 'wt1', status: 'running', displayName: 'My Session' },
    ]);
    mockGroveBench.validateRepo.mockResolvedValueOnce(true);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      { id: 'wt1', branch: 'feat/test', direct: false },
    ]);
    mockGroveBench.resumeSession.mockResolvedValueOnce({ id: 'wt1' });

    await restoreWorktrees();

    expect(store.sessions[0].status).toBe('running');
    expect(store.sessions[0].displayName).toBe('My Session');
    expect(mockGroveBench.resumeSession).toHaveBeenCalledWith('wt1', '/repo/a');
  });

  it('continues restoring other repos when one throws', async () => {
    store.repos = ['/repo/a', '/repo/b'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.validateRepo
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      { id: 'wt1', branch: 'main', direct: true },
    ]);

    await restoreWorktrees();

    expect(store.repos).toEqual(['/repo/a', '/repo/b']);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].repoPath).toBe('/repo/b');
  });
});
