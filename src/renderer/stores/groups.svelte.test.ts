import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { groupStore, groupName } from './groups.svelte.js';
import { store } from './sessions.svelte.js';
import type { ConversationGroup } from '../../shared/types.js';

/** The groups as last saved through main. */
function saved() {
  const calls = mockGroveBench.setConversationGroups.mock.calls;
  return calls[calls.length - 1]?.[0];
}

/** Make a group the test needs to exist. */
function make(name: string, ids: string[]): ConversationGroup {
  const group = groupStore.create(name, ids);
  if (!group) throw new Error('group not made');
  return group;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/api', '/web', '/infra'];
  store.sessions = [
    { id: 'api1', branch: 'feat/billing', repoPath: '/api', status: 'running' },
    { id: 'web1', branch: 'grove/0a1b2c3d', repoPath: '/web', status: 'running' },
    { id: 'web2', branch: 'main', repoPath: '/web', status: 'stopped', direct: true },
  ] as any;
  groupStore.groups = [];
  groupStore.ready = true;
  groupStore.nameRequest = null;
});

afterEach(() => {
  store.repos = [];
  store.sessions = [];
  groupStore.groups = [];
});

describe('groupStore loading', () => {
  beforeEach(() => { groupStore.ready = false; });
  afterEach(() => {
    mockGroveBench.getConversationGroups.mockReset();
    mockGroveBench.getConversationGroups.mockResolvedValue([]);
  });

  it('loads the saved groups and allows changes', async () => {
    const group = { id: 'g1', name: 'Billing', sessionIds: ['api1'] };
    mockGroveBench.getConversationGroups.mockResolvedValueOnce([group]);
    await groupStore.load(0);
    expect(groupStore.groups).toEqual([group]);
    expect(groupStore.ready).toBe(true);
  });

  it('asks again while the file can\'t be read', async () => {
    const group = { id: 'g1', name: 'Billing', sessionIds: ['api1'] };
    mockGroveBench.getConversationGroups.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('ipc')).mockResolvedValueOnce([group]);
    await groupStore.load(0);
    expect(mockGroveBench.getConversationGroups).toHaveBeenCalledTimes(3);
    expect(groupStore.groups).toEqual([group]);
    expect(groupStore.ready).toBe(true);
  });

  it('saves nothing while the saved groups are unknown, so they can\'t be written over', async () => {
    mockGroveBench.getConversationGroups.mockResolvedValue(null);
    await groupStore.load(0);
    expect(groupStore.ready).toBe(false);

    expect(groupStore.create('Billing', ['api1'])).toBeNull();
    groupStore.remove('api1');
    expect(groupStore.groups).toEqual([]);
    expect(mockGroveBench.setConversationGroups).not.toHaveBeenCalled();
  });
});

describe('groupStore', () => {
  it('creates a group with a conversation and saves it', () => {
    const group = make('  Billing ', ['api1']);
    expect(group).toMatchObject({ name: 'Billing', sessionIds: ['api1'] });
    expect(groupStore.groupOf('api1')?.id).toBe(group.id);
    expect(saved()).toEqual([group]);
  });

  it('names a group with no name', () => {
    expect(make('   ', ['api1']).name).toBe('New group');
    expect(groupName(' x ')).toBe('x');
  });

  it('never makes an empty group, and lists a conversation once', () => {
    expect(groupStore.create('Empty', [])).toBeNull();
    expect(groupStore.groups).toEqual([]);
    expect(make('A', ['api1', 'api1']).sessionIds).toEqual(['api1']);
  });

  it('keeps a conversation in one group at a time', () => {
    const a = make('A', ['api1', 'web1']);
    const b = make('B', ['web2']);
    groupStore.add(b.id, 'web1');
    expect(groupStore.get(a.id)?.sessionIds).toEqual(['api1']);
    expect(groupStore.get(b.id)?.sessionIds).toEqual(['web2', 'web1']);
  });

  it('drops a group when its last conversation leaves', () => {
    const a = make('A', ['api1']);
    groupStore.remove('api1');
    expect(groupStore.get(a.id)).toBeNull();
    expect(saved()).toEqual([]);
  });

  it('moving the last conversation out drops the group it left', () => {
    const a = make('A', ['api1']);
    const b = make('B', ['web1']);
    groupStore.add(b.id, 'api1');
    expect(groupStore.get(a.id)).toBeNull();
    expect(groupStore.get(b.id)?.sessionIds).toEqual(['web1', 'api1']);
  });

  it('adding to a group that is gone does nothing', () => {
    groupStore.add('gone', 'api1');
    expect(groupStore.groups).toEqual([]);
    expect(mockGroveBench.setConversationGroups).not.toHaveBeenCalled();
  });

  it('ungroups without touching the conversations', () => {
    const a = make('A', ['api1', 'web1']);
    groupStore.ungroup(a.id);
    expect(groupStore.groups).toEqual([]);
    expect(store.sessions.map((s) => s.id)).toEqual(['api1', 'web1', 'web2']);
  });

  it('renames, ignoring an empty name', () => {
    const a = make('A', ['api1']);
    groupStore.rename(a.id, 'Billing');
    groupStore.rename(a.id, '  ');
    expect(groupStore.get(a.id)?.name).toBe('Billing');
  });

  it('lists the members it has loaded, in join order, and follows the conversation list', () => {
    const a = make('A', ['web1', 'gone', 'api1']);
    expect(groupStore.members(a.id).map((s) => s.id)).toEqual(['web1', 'api1']);
    // One in a project that didn't load stays in the group.
    expect(groupStore.get(a.id)?.sessionIds).toContain('gone');
    // It shows once its project loads.
    store.sessions = [...store.sessions, { id: 'gone', branch: 'x', repoPath: '/infra', status: 'stopped' }] as any;
    expect(groupStore.members(a.id).map((s) => s.id)).toEqual(['web1', 'gone', 'api1']);
  });

  describe('sharedBranch', () => {
    it('is the first real branch, skipping placeholders and the project folder', () => {
      const a = make('A', ['web2', 'web1', 'api1']);
      expect(groupStore.sharedBranch(a.id, '/infra')).toBe('feat/billing');
    });

    it('is empty when no conversation has one yet', () => {
      const a = make('A', ['web1', 'web2']);
      expect(groupStore.sharedBranch(a.id, '/infra')).toBe('');
    });

    it('is empty in a project the group already has a conversation in', () => {
      const a = make('A', ['api1', 'web1']);
      expect(groupStore.sharedBranch(a.id, '/api')).toBe('');
      expect(groupStore.sharedBranch(a.id, '/web')).toBe('');
    });
  });

  describe('nextProject', () => {
    it('is the first project the group has nothing in yet', () => {
      const a = make('A', ['api1', 'web1']);
      expect(groupStore.nextProject(a.id)).toBe('/infra');
    });

    it('falls back to the first conversation\'s project when every project is used', () => {
      store.repos = ['/api', '/web'];
      const a = make('A', ['web1', 'api1']);
      expect(groupStore.nextProject(a.id)).toBe('/web');
    });
  });
});
