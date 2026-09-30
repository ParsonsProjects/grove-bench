import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { draftStore } from './draft.svelte.js';
import { store } from './sessions.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { messageStore } from './messages.svelte.js';
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
  store.repos = [];
  store.sessions = [];
  store.activeSessionId = null;
  agentsStore.list = [];
  agentsStore.loaded = false;
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

  it('starts a PR in Plan mode unless a mode was picked', () => {
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.controlValue('permissionMode')).toBe('plan');
    // Back to a plain branch: back to the default.
    draftStore.setStart({ kind: 'existing', branch: 'fix/b' });
    expect(draftStore.controlValue('permissionMode')).toBe('default');

    draftStore.setControl('permissionMode', 'acceptEdits');
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
    addUserMessage.mockRestore();
  });

  it('starts without a message and sends nothing', async () => {
    draftStore.open('/repo/one');
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
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
  it('applies Plan for a PR picked before the agent\'s modes have loaded', async () => {
    let release: (v: ControlDescriptor[]) => void = () => {};
    mockGroveBench.getAdapterControls.mockReturnValue(new Promise((r) => { release = r; }));
    draftStore.open('/repo/one');
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    expect(draftStore.draft?.controls.permissionMode).toBeUndefined();

    release([modeControl, effortControl]);
    await settle();
    expect(draftStore.controlValue('permissionMode')).toBe('plan');
  });

  it('keeps a PR draft in Plan after the agent changes', async () => {
    draftStore.open('/repo/one');
    await settle();
    draftStore.setStart({ kind: 'existing', branch: 'feat/a', pr: { number: 7, title: 'Add login' } });
    draftStore.setAgent('codex');
    await settle();
    expect(draftStore.draft?.controls.permissionMode).toBe('plan');
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
  beforeEach(() => store.setFolderProject('/repo/two', true));
  afterEach(() => store.setFolderProject('/repo/two', false));

  it('starts in the project folder itself', async () => {
    draftStore.open('/repo/two');
    await settle();
    expect(draftStore.draft?.start).toEqual({ kind: 'folder' });
    draftStore.resetToNewBranch();
    expect(draftStore.draft?.start).toEqual({ kind: 'folder' });
    expect(mockGroveBench.getDefaultBranch).not.toHaveBeenCalled();
  });

  it('creates a conversation in the folder and marks it as having no git', async () => {
    createSessionMock().mockResolvedValue({ id: 'n1', branch: '', agentType: 'claude-code' });
    draftStore.open('/repo/two');
    await settle();
    expect(await draftStore.start()).toBe(true);
    expect(createSessionMock()).toHaveBeenCalledWith(expect.objectContaining({ repoPath: '/repo/two', branchName: '', direct: true }));
    expect(store.sessions.find((s) => s.id === 'n1')).toMatchObject({ direct: true, noGit: true, status: 'running' });
  });
});
});
