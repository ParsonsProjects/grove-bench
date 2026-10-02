import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { store } from '../stores/sessions.svelte.js';
import { restoreWorktrees } from './restore-worktrees.js';
import type { WorktreeInfo, SessionInfo } from '../../shared/types.js';

function makeWorktree(overrides: Partial<WorktreeInfo> & { id: string; branch: string }): WorktreeInfo {
  return { path: '/wt', repoPath: '/repo', createdAt: Date.now(), ...overrides };
}

function makeSessionInfo(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return { branch: 'main', worktreePath: '/wt', repoPath: '/repo', status: 'running', agentType: 'claude-code', createdAt: Date.now(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [];
  store.activeSessionId = null;
  store.error = null;
  store.repos = [];
});

describe('restoreWorktrees', () => {
  it('does not remove repo when repoKind throws', async () => {
    store.repos = ['/repo/a', '/repo/b'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.repoKind
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce('git');
    mockGroveBench.listWorktrees.mockResolvedValueOnce([]);

    await restoreWorktrees();

    expect(store.repos).toContain('/repo/a');
    expect(store.repos).toContain('/repo/b');
  });

  it('does not remove repo when listWorktrees throws', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
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

  it('keeps a project whose folder is gone, without restoring its conversations', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.repoKind.mockResolvedValueOnce('missing');

    await restoreWorktrees();

    expect(store.repos).toContain('/repo/a');
    expect(mockGroveBench.listWorktrees).not.toHaveBeenCalled();
  });

  it('restores a folder project without git and its conversations', async () => {
    store.repos = ['/notes'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.repoKind.mockResolvedValueOnce('folder');
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      makeWorktree({ id: 'n1', branch: '', repoPath: '/notes', path: '/notes', direct: true, noGit: true }),
    ]);

    await restoreWorktrees();

    expect(store.isFolderProject('/notes')).toBe(true);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({ id: 'n1', branch: '', direct: true, noGit: true });
    store.setFolderProject('/notes', false);
  });

  it('clears the folder mark once a project has become a git repository', async () => {
    store.repos = ['/notes'];
    store.setFolderProject('/notes', true);

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.repoKind.mockResolvedValueOnce('git');
    mockGroveBench.listWorktrees.mockResolvedValueOnce([]);

    await restoreWorktrees();

    expect(store.isFolderProject('/notes')).toBe(false);
  });

  it('restores worktree sessions from valid repos', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      makeWorktree({ id: 'wt1', branch: 'feat/test', direct: false }),
    ]);

    await restoreWorktrees();

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe('wt1');
    expect(store.sessions[0].status).toBe('stopped');
  });

  it('marks session as running when it has a running session', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([
      makeSessionInfo({ id: 'wt1', status: 'running', displayName: 'My Session' }),
    ]);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      makeWorktree({ id: 'wt1', branch: 'feat/test', direct: false }),
    ]);
    mockGroveBench.resumeSession.mockResolvedValueOnce({ id: 'wt1' });

    await restoreWorktrees();

    expect(store.sessions[0].status).toBe('running');
    expect(store.sessions[0].displayName).toBe('My Session');
    expect(mockGroveBench.resumeSession).toHaveBeenCalledWith('wt1', '/repo/a');
  });

  it('keeps a session main has put to sleep asleep, without waking it', async () => {
    store.repos = ['/repo/a'];

    mockGroveBench.listSessions.mockResolvedValueOnce([
      makeSessionInfo({ id: 'wt1', status: 'sleeping' }),
    ]);
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      makeWorktree({ id: 'wt1', branch: 'feat/test', direct: false }),
    ]);
    mockGroveBench.resumeSession.mockResolvedValueOnce({ id: 'wt1' });

    await restoreWorktrees();

    expect(store.sessions[0].status).toBe('sleeping');
    // Resume only reattaches the window to the session main still holds.
    expect(mockGroveBench.resumeSession).toHaveBeenCalledWith('wt1', '/repo/a');
  });

  it('continues restoring other repos when one throws', async () => {
    store.repos = ['/repo/a', '/repo/b'];

    mockGroveBench.listSessions.mockResolvedValueOnce([]);
    mockGroveBench.repoKind
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('git');
    mockGroveBench.listWorktrees.mockResolvedValueOnce([
      makeWorktree({ id: 'wt1', branch: 'main', direct: true }),
    ]);

    await restoreWorktrees();

    expect(store.repos).toEqual(['/repo/a', '/repo/b']);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].repoPath).toBe('/repo/b');
  });
});
