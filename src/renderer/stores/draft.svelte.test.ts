import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { draftStore } from './draft.svelte.js';
import { store } from './sessions.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { messageStore } from './messages.svelte.js';
import { arrivalScene } from './arrivalScene.svelte.js';
import { settingsStore } from './settings.svelte.js';
import { groupStore } from './groups.svelte.js';
import type { ControlDescriptor } from '../../shared/types.js';

const modeControl: ControlDescriptor = {
  id: 'permissionMode', label: 'Mode', default: 'default',
  options: [{ value: 'default', label: 'Ask' }, { value: 'plan', label: 'Plan' }, { value: 'acceptEdits', label: 'Edit' }],
};
const effortControl: ControlDescriptor = {
  id: 'effort', label: 'Effort', default: 'medium',
  options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
};

function createSessionMock() {
  return (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession;
}

/** Let the async model/control loads settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  draftStore.discard();
  // Starting with a message begins the new conversation's arrival scene;
  // the mocked createSession always returns 'new1'.
  arrivalScene.end('new1');
  store.repos = ['/repo/one', '/repo/two'];
  store.sessions = [];
  store.activeSessionId = null;
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: { permissionModes: true }, isDefault: true },
    { id: 'codex', displayName: 'Codex', capabilities: {} },
  ];
  agentsStore.loaded = true;
  mockGroveBench.getModels.mockResolvedValue([{ id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku' }]);
  mockGroveBench.getAdapterControls.mockResolvedValue([modeControl, effortControl]);
  mockGroveBench.getDefaultBranch.mockResolvedValue('main');
  (mockGroveBench as unknown as { createSession: ReturnType<typeof vi.fn> }).createSession = vi.fn()
    .mockResolvedValue({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
});

afterEach(() => {
  draftStore.discard();
  groupStore.groups = [];
  store.repos = [];
  store.sessions = [];
  store.activeSessionId = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
  settingsStore.current = { ...settingsStore.current, adapterDefaults: {} };
});

describe('draftStore.open', () => {
  it('opens in the given project on the default agent, starting a new branch from the default branch', async () => {
    draftStore.open('/repo/two');
    await settle();
    expect(draftStore.draft).toMatchObject({ repoPath: '/repo/two', agentId: 'claude-code', start: { kind: 'new', branchName: '', baseBranch: 'main' } });
    expect(draftStore.visible).toBe(true);
    expect(draftStore.models.map((m) => m.value)).toEqual(['opus', 'haiku']);
  });

  it('defaults to the open conversation\'s project, agent and model', () => {
    store.sessions = [{ id: 's1', branch: 'feat/x', repoPath: '/repo/two', status: 'running', agentType: 'codex' }];
    store.activeSessionId = 's1';
    vi.spyOn(messageStore, 'getModel').mockReturnValue('o4');
    draftStore.open();
    expect(draftStore.draft).toMatchObject({ repoPath: '/repo/two', agentId: 'codex', model: 'o4' });
    // Opening the draft takes over the main pane.
    expect(store.activeSessionId).toBeNull();
  });

  it('keeps the typed message when opened again in another project', () => {
    draftStore.open('/repo/one');
    draftStore.setText('Fix API-12');
    draftStore.open('/repo/two');
    expect(draftStore.draft).toMatchObject({ repoPath: '/repo/two', text: 'Fix API-12' });
  });

  it('does nothing without a project', () => {
    store.repos = [];
    draftStore.open();
    expect(draftStore.draft).toBeNull();
  });

  describe('an alpha agent', () => {
    beforeEach(() => {
      agentsStore.list = [...agentsStore.list, { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' }];
    });
    afterEach(() => {
      settingsStore.current = { ...settingsStore.current, enabledAlphaAgents: [] };
    });

    it('is not offered until turned on, even from a conversation that runs on it', () => {
      store.sessions = [{ id: 's1', branch: 'b', repoPath: '/repo/one', status: 'running', agentType: 'opencode' }];
      store.activeSessionId = 's1';
      draftStore.open();
      expect(draftStore.draft?.agentId).toBe('claude-code');
      draftStore.setAgent('opencode');
      expect(draftStore.draft?.agentId).toBe('claude-code');
      draftStore.discard();
      draftStore.open('/repo/one', { agentId: 'opencode' });
      expect(draftStore.draft?.agentId).toBe('claude-code');
    });

    it('can be picked once turned on', () => {
      settingsStore.current = { ...settingsStore.current, enabledAlphaAgents: ['opencode'] };
      draftStore.open('/repo/one');
      draftStore.setAgent('opencode');
      expect(draftStore.draft?.agentId).toBe('opencode');
    });
  });

  it('switches agent when opened for another agent', async () => {
    draftStore.open('/repo/one');
    draftStore.setModel('haiku');
    draftStore.open('/repo/one', { agentId: 'codex' });
    await settle();
    expect(draftStore.draft).toMatchObject({ agentId: 'codex', model: '' });
    expect(mockGroveBench.getModels).toHaveBeenLastCalledWith('codex');
  });
});

describe('draftStore choices', () => {
  beforeEach(async () => {
    draftStore.open('/repo/one');
    await settle();
  });

  it('shows saved and picked control values', () => {
    expect(draftStore.controlValue('permissionMode')).toBe('default');
    draftStore.setControl('effort', 'high');
    expect(draftStore.controlValue('effort')).toBe('high');
  });

  it('leaves the mode alone when a PR or branch is picked', () => {
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.controlValue('permissionMode')).toBe('default');

    draftStore.setControl('permissionMode', 'acceptEdits');
    draftStore.setStart({ kind: 'existing', branch: 'fix/b' });
    expect(draftStore.controlValue('permissionMode')).toBe('acceptEdits');
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.controlValue('permissionMode')).toBe('acceptEdits');
  });

  it('resets model and controls when the agent changes', async () => {
    draftStore.setModel('haiku');
    draftStore.setControl('effort', 'high');
    draftStore.setAgent('codex');
    await settle();
    expect(draftStore.draft).toMatchObject({ agentId: 'codex', model: '', controls: {} });
  });

  it('moving to another project goes back to a new branch', async () => {
    draftStore.setStart({ kind: 'existing', branch: 'feat/a' });
    draftStore.setRepo('/repo/two');
    await settle();
    expect(draftStore.draft?.start).toEqual({ kind: 'new', branchName: '', baseBranch: 'main' });
  });
});

describe('draftStore.buildOpts', () => {
  beforeEach(async () => {
    draftStore.open('/repo/one');
    await settle();
  });

  it('sends only what was picked', () => {
    const opts = draftStore.buildOpts(draftStore.draft!, 'main');
    expect(opts).toEqual({ repoPath: '/repo/one', adapterType: 'claude-code', branchName: '', baseBranch: 'main' });
  });

  it('sends the picked model, controls and mode', () => {
    draftStore.setModel('haiku');
    draftStore.setControl('effort', 'high');
    draftStore.setControl('permissionMode', 'plan');
    expect(draftStore.buildOpts(draftStore.draft!, 'main')).toMatchObject({
      model: 'haiku', controls: { effort: 'high' }, permissionMode: 'plan',
    });
  });

  it('maps each place to run to its create options', () => {
    draftStore.setStart({ kind: 'folder' });
    expect(draftStore.buildOpts(draftStore.draft!, '')).toMatchObject({ branchName: '', direct: true });
    draftStore.setStart({ kind: 'existing', branch: 'feat/a' });
    expect(draftStore.buildOpts(draftStore.draft!, '')).toMatchObject({ branchName: 'feat/a', useExisting: true });
    draftStore.setStart({ kind: 'new', branchName: ' feat/API-1 ', baseBranch: 'develop' });
    expect(draftStore.buildOpts(draftStore.draft!, 'develop')).toMatchObject({ branchName: 'feat/API-1', baseBranch: 'develop' });
  });
});

describe('draftStore.start', () => {
  it('creates the conversation, sends the message and clears the draft', async () => {
    const addUserMessage = vi.spyOn(messageStore, 'addUserMessage');
    draftStore.open('/repo/one');
    await settle();
    draftStore.setText('Fix API-12 login crash');

    expect(await draftStore.start()).toBe(true);
    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/one', branchName: '', baseBranch: 'main' }));
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith('new1', 'Fix API-12 login crash');
    expect(addUserMessage).toHaveBeenCalledWith('new1', 'Fix API-12 login crash');
    expect(store.activeSessionId).toBe('new1');
    expect(store.sessions.find((s) => s.id === 'new1')?.displayName).toBeTruthy();
    expect(draftStore.draft).toBeNull();
    // The chat shows the agent walking to its bench until the first reply.
    expect(arrivalScene.for('new1')).not.toBeNull();
    addUserMessage.mockRestore();
    arrivalScene.end('new1');
  });

  it('starts without a message and sends nothing', async () => {
    draftStore.open('/repo/one');
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(arrivalScene.for('new1')).toBeNull();
  });

  it('resolves the base branch when none is set', async () => {
    draftStore.open('/repo/one');
    await settle();
    draftStore.setStart({ kind: 'new', branchName: '', baseBranch: '' });
    mockGroveBench.getDefaultBranch.mockResolvedValue('trunk');
    await draftStore.start();
    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: 'trunk' }));
  });

  it('keeps the draft and shows the error when creation fails', async () => {
    createSessionMock().mockRejectedValue(new Error('Branch "feat/x" already exists'));
    draftStore.open('/repo/one');
    await settle();
    draftStore.setText('hello');
    expect(await draftStore.start()).toBe(false);
    expect(draftStore.error).toContain('already exists');
    expect(draftStore.draft?.text).toBe('hello');
  });

  it('will not start an existing-branch draft with no branch', async () => {
    draftStore.open('/repo/one');
    draftStore.setStart({ kind: 'existing', branch: '' });
    expect(await draftStore.start()).toBe(false);
    expect(createSessionMock()).not.toHaveBeenCalled();
  });
});

describe('draftStore review fixes', () => {
  it('starts a PR on the saved default mode, not Plan', async () => {
    settingsStore.current = { ...settingsStore.current, adapterDefaults: { 'claude-code': { permissionMode: 'acceptEdits' } } };
    draftStore.open('/repo/one');
    await settle();
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.controlValue('permissionMode')).toBe('acceptEdits');
    expect(draftStore.buildOpts(draftStore.draft!, '').permissionMode).toBeUndefined();
  });

  it('refuses to start in a project that was removed', async () => {
    draftStore.open('/repo/one');
    await settle();
    store.repos = ['/repo/two'];
    expect(await draftStore.start()).toBe(false);
    expect(draftStore.error).toContain('project was removed');
    expect(createSessionMock()).not.toHaveBeenCalled();
  });

describe('draftStore in a folder project without git', () => {
  beforeEach(() => {
    store.setFolderProject('/repo/two', true);
    mockGroveBench.repoKind.mockResolvedValue('folder');
  });
  afterEach(() => {
    store.setFolderProject('/repo/two', false);
    mockGroveBench.repoKind.mockResolvedValue('git');
  });

  it('starts in the project folder itself', async () => {
    draftStore.open('/repo/two');
    await settle();
    expect(draftStore.draft?.start).toEqual({ kind: 'folder' });
    draftStore.resetToNewBranch();
    expect(draftStore.draft?.start).toEqual({ kind: 'folder' });
    expect(mockGroveBench.getDefaultBranch).not.toHaveBeenCalled();
  });

  it('creates a conversation in the folder and marks it as having no git', async () => {
    createSessionMock().mockResolvedValue({ id: 'n1', branch: '', agentType: 'claude-code', noGit: true });
    draftStore.open('/repo/two');
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/two', branchName: '', direct: true }));
    expect(store.sessions.find((s) => s.id === 'n1')).toMatchObject({ direct: true, noGit: true, status: 'running' });
  });

  it('goes back to a new branch when the folder has become a git repository since launch', async () => {
    mockGroveBench.repoKind.mockResolvedValue('git');
    draftStore.open('/repo/two');
    await settle();
    expect(store.isFolderProject('/repo/two')).toBe(false);
    expect(draftStore.draft?.start).toMatchObject({ kind: 'new', baseBranch: 'main' });
  });

  it('trusts main over its own flag when marking the new conversation', async () => {
    // Main found a repository after all, so the conversation runs with git.
    createSessionMock().mockResolvedValue({ id: 'g1', branch: 'main', agentType: 'claude-code' });
    draftStore.open('/repo/two');
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(store.sessions.find((s) => s.id === 'g1')?.noGit).toBeUndefined();
  });
});
});

describe('draftStore.start while it is still starting', () => {
  it('files the conversation under the project it started in, even if the picker changes', async () => {
    let finish!: (v: unknown) => void;
    createSessionMock().mockReturnValueOnce(new Promise((r) => { finish = r; }));
    draftStore.open('/repo/one');
    draftStore.setText('hello');
    await settle();

    const started = draftStore.start();
    await settle();
    draftStore.setRepo('/repo/two');
    finish({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
    await started;

    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/one' }));
    expect(store.sessions.find((s) => s.id === 'new1')?.repoPath).toBe('/repo/one');
  });

  it('leaves a new draft opened meanwhile alone', async () => {
    let finish!: (v: unknown) => void;
    createSessionMock().mockReturnValueOnce(new Promise((r) => { finish = r; }));
    draftStore.open('/repo/one');
    draftStore.setText('first');
    await settle();

    const started = draftStore.start();
    await settle();
    draftStore.discard();
    draftStore.open('/repo/two');
    draftStore.setText('second, still being typed');
    finish({ id: 'new1', branch: 'grove/new1', agentType: 'claude-code' });
    await started;

    expect(draftStore.draft?.text).toBe('second, still being typed');
  });
});

describe('draft in a group', () => {
  let billing: string;

  beforeEach(() => {
    groupStore.ready = true;
    store.sessions = [{ id: 'api1', branch: 'feat/billing', repoPath: '/repo/one', status: 'running' }] as any;
    billing = groupStore.create('Billing', ['api1'])!.id;
  });

  it('starts a new branch with the group\'s branch name, but not where the group has one', async () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    await settle();
    expect(draftStore.draft).toMatchObject({ groupId: billing, start: { kind: 'new', branchName: 'feat/billing', baseBranch: 'main' } });
    expect(draftStore.onGroupBranch).toBe(true);
    expect(draftStore.groupName).toBe('Billing');

    // The group's conversation in /repo/one has the branch there already.
    draftStore.setRepo('/repo/one');
    expect(draftStore.draft?.start).toMatchObject({ kind: 'new', branchName: '' });
    expect(draftStore.onGroupBranch).toBe(false);
  });

  it('moves an open draft into the group, keeping its message', () => {
    draftStore.open('/repo/two');
    draftStore.setText('keep me');
    draftStore.open('/repo/two', { group: { groupId: billing } });
    expect(draftStore.draft).toMatchObject({ groupId: billing, text: 'keep me', start: { branchName: 'feat/billing' } });
  });

  it('leaves the group when opened from a project, dropping the group\'s branch name', () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    draftStore.open('/repo/two');
    expect(draftStore.draft?.groupId).toBeUndefined();
    expect(draftStore.draft?.start).toMatchObject({ kind: 'new', branchName: '' });
  });

  it('stays in the group when shown again without a project', () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    draftStore.open();
    expect(draftStore.draft?.groupId).toBe(billing);
  });

  it('leaving the group keeps a branch the user picked', () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    draftStore.setStart({ kind: 'new', branchName: 'mine', baseBranch: 'main' });
    draftStore.leaveGroup();
    expect(draftStore.draft?.groupId).toBeUndefined();
    expect(draftStore.draft?.start).toMatchObject({ branchName: 'mine' });
  });

  it('asks main to continue the group\'s branch, and joins the group when it starts', async () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/two', branchName: 'feat/billing', continueBranch: true }));
    expect(groupStore.get(billing)?.sessionIds).toEqual(['api1', 'new1']);
  });

  it('doesn\'t ask to continue a branch the user renamed', async () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    await settle();
    draftStore.setStart({ kind: 'new', branchName: 'feat/other', baseBranch: 'main' });
    await draftStore.start();
    expect(createSessionMock().mock.calls[0][0]).not.toHaveProperty('continueBranch');
    expect(groupStore.get(billing)?.sessionIds).toEqual(['api1', 'new1']);
  });

  it('starts anyway when the group was dropped meanwhile', async () => {
    draftStore.open('/repo/two', { group: { groupId: billing } });
    await settle();
    groupStore.ungroup(billing);
    expect(await draftStore.start()).toBe(true);
    expect(groupStore.groups).toEqual([]);
  });

  describe('a new group', () => {
    it('is made only when its first conversation starts', async () => {
      groupStore.ungroup(billing);
      draftStore.open('/repo/two', { group: { newGroupName: 'Payments' } });
      expect(draftStore.groupName).toBe('Payments');
      expect(groupStore.groups).toEqual([]);

      await draftStore.start();
      expect(groupStore.groups).toEqual([expect.objectContaining({ name: 'Payments', sessionIds: ['new1'] })]);
    });

    it('leaves nothing behind when the draft is discarded', () => {
      groupStore.ungroup(billing);
      draftStore.open('/repo/two', { group: { newGroupName: 'Payments' } });
      draftStore.discard();
      expect(groupStore.groups).toEqual([]);
    });

    it('is replaced by joining an existing group', () => {
      draftStore.open('/repo/two', { group: { newGroupName: 'Payments' } });
      draftStore.open('/repo/two', { group: { groupId: billing } });
      expect(draftStore.draft?.newGroupName).toBeUndefined();
      expect(draftStore.draft?.groupId).toBe(billing);
    });
  });
});
