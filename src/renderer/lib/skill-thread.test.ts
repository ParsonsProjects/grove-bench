import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startSkillThread } from './skill-thread.js';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';

describe('startSkillThread', () => {
  let startThread: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    startThread = vi.spyOn(draftStore, 'startThread').mockResolvedValue(true);
    vi.spyOn(messageStore, 'getModel').mockReturnValue('o4');
    store.sessions = [{ id: 's1', branch: 'feat/x', repoPath: '/repo/one', status: 'running', agentType: 'codex' }];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.sessions = [];
  });

  it('starts a project skill on a new branch, on the asking thread\'s agent and model', async () => {
    expect(await startSkillThread('s1', { name: 'release-notes', description: 'Draft release notes', scope: 'project' })).toBe(true);
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo/one',
      agentId: 'codex',
      model: 'o4',
      start: { kind: 'new', branchName: '', baseBranch: '' },
    }));
    expect(startThread.mock.calls[0][0].text).toContain('`release-notes`');
  });

  it('names the default agent for a thread with no agent type, so its model carries over', async () => {
    agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: {}, isDefault: true }];
    store.sessions = [{ id: 's1', branch: 'feat/x', repoPath: '/repo/one', status: 'running' }];
    try {
      await startSkillThread('s1', { name: 'x', description: 'd', scope: 'project' });
      expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude-code', model: 'o4' }));
    } finally {
      agentsStore.list = [];
    }
  });

  it('starts a user skill in the project folder', async () => {
    await startSkillThread('s1', { name: 'x', description: 'd', scope: 'user' });
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ start: { kind: 'folder' } }));
  });

  it('runs a project skill in the folder of a project without git, and says so', async () => {
    store.setFolderProject('/repo/one', true);
    try {
      await startSkillThread('s1', { name: 'x', description: 'd', scope: 'project' });
      const setup = startThread.mock.calls[0][0];
      expect(setup.start).toEqual({ kind: 'folder' });
      expect(setup.text).toContain('inside this project folder');
      expect(setup.text).not.toContain('branch');
    } finally {
      store.setFolderProject('/repo/one', false);
    }
  });

  it('starts nothing when the asking thread is gone', async () => {
    expect(await startSkillThread('gone', { name: 'x', description: 'd', scope: 'project' })).toBe(false);
    expect(startThread).not.toHaveBeenCalled();
  });
});
