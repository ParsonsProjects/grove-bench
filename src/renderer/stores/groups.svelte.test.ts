import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { groupStore } from './groups.svelte.js';
import { store } from './sessions.svelte.js';

/** The groups as last saved through main. */
function saved() {
  const calls = mockGroveBench.setConversationGroups.mock.calls;
  return calls[calls.length - 1]?.[0];
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
  groupStore.nameRequest = null;
});

afterEach(() => {
  store.repos = [];
  store.sessions = [];
  groupStore.groups = [];
});

describe('groupStore', () => {
  it('loads the saved groups', async () => {
    const group = { id: 'g1', name: 'Billing', createdAt: 1, sessionIds: ['api1'] };
    mockGroveBench.getConversationGroups.mockResolvedValueOnce([group]);
    await groupStore.load();
    expect(groupStore.groups).toEqual([group]);
  });

  it('creates a group with a conversation and saves it', () => {
    const group = groupStore.create('  Billing ', ['api1']);
    expect(group).toMatchObject({ name: 'Billing', sessionIds: ['api1'] });
    expect(groupStore.groupOf('api1')?.id).toBe(group.id);
    expect(saved()).toEqual([group]);
  });

  it('names a group with no name', () => {
    expect(groupStore.create('   ').name).toBe('New group');
  });

  it('keeps a conversation in one group at a time', () => {
    const a = groupStore.create('A', ['api1', 'web1']);
    const b = groupStore.create('B', ['web2']);
    groupStore.add(b.id, 'web1');
    expect(groupStore.get(a.id)?.sessionIds).toEqual(['api1']);
    expect(groupStore.get(b.id)?.sessionIds).toEqual(['web2', 'web1']);
  });

  it('drops a group when its last conversation leaves, but keeps a new empty one', () => {
    const empty = groupStore.create('Empty');
    const a = groupStore.create('A', ['api1']);
    groupStore.remove('api1');
    expect(groupStore.get(a.id)).toBeNull();
    expect(groupStore.get(empty.id)).not.toBeNull();
  });

  it('moving the last conversation out drops the group it left', () => {
    const a = groupStore.create('A', ['api1']);
    const b = groupStore.create('B', ['web1']);
    groupStore.add(b.id, 'api1');
    expect(groupStore.get(a.id)).toBeNull();
    expect(groupStore.get(b.id)?.sessionIds).toEqual(['web1', 'api1']);
  });

  it('ungroups without touching the conversations', () => {
    const a = groupStore.create('A', ['api1', 'web1']);
    groupStore.ungroup(a.id);
    expect(groupStore.groups).toEqual([]);
    expect(store.sessions.map((s) => s.id)).toEqual(['api1', 'web1', 'web2']);
  });

  it('renames, ignoring an empty name', () => {
    const a = groupStore.create('A');
    groupStore.rename(a.id, 'Billing');
    groupStore.rename(a.id, '  ');
    expect(groupStore.get(a.id)?.name).toBe('Billing');
  });

  it('lists the members it has loaded, in join order', () => {
    const a = groupStore.create('A', ['web1', 'gone', 'api1']);
    expect(groupStore.members(a.id).map((s) => s.id)).toEqual(['web1', 'api1']);
    // One in a project that didn't load stays in the group.
    expect(groupStore.get(a.id)?.sessionIds).toContain('gone');
  });

  describe('sharedBranch', () => {
    it('is the first real branch, skipping placeholders and the project folder', () => {
      const a = groupStore.create('A', ['web2', 'web1', 'api1']);
      expect(groupStore.sharedBranch(a.id, '/infra')).toBe('feat/billing');
    });

    it('is empty when no conversation has one yet', () => {
      const a = groupStore.create('A', ['web1', 'web2']);
      expect(groupStore.sharedBranch(a.id, '/infra')).toBe('');
    });

    it('is empty in a project the group already has a conversation in', () => {
      const a = groupStore.create('A', ['api1', 'web1']);
      expect(groupStore.sharedBranch(a.id, '/api')).toBe('');
      expect(groupStore.sharedBranch(a.id, '/web')).toBe('');
    });
  });

  describe('nextProject', () => {
    it('is the first project the group has nothing in yet', () => {
      const a = groupStore.create('A', ['api1', 'web1']);
      expect(groupStore.nextProject(a.id)).toBe('/infra');
    });

    it('falls back to the first conversation\'s project when every project is used', () => {
      store.repos = ['/api', '/web'];
      const a = groupStore.create('A', ['web1', 'api1']);
      expect(groupStore.nextProject(a.id)).toBe('/web');
    });

    it('is the first project for an empty group', () => {
      const a = groupStore.create('A');
      expect(groupStore.nextProject(a.id)).toBe('/api');
    });
  });
});
