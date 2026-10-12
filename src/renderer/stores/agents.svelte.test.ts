import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { agentsStore } from './agents.svelte.js';

const claude = { id: 'claude-code', displayName: 'Claude Agent', capabilities: { plugins: true, mcpConfig: true } };
const codex = { id: 'codex', displayName: 'Codex', capabilities: { plugins: false, mcpConfig: false }, isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('agentsStore', () => {
  it('loads the agent list once and shares a load in flight', async () => {
    mockGroveBench.listAdapters.mockResolvedValue([claude, codex]);
    await Promise.all([agentsStore.load(), agentsStore.load()]);
    await agentsStore.load();
    expect(mockGroveBench.listAdapters).toHaveBeenCalledTimes(1);
    expect(agentsStore.list.map((a) => a.id)).toEqual(['claude-code', 'codex']);
  });

  it('offers an alpha agent for new conversations only once it is turned on', () => {
    const opencode = { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' as const };
    agentsStore.list = [claude, opencode];
    expect(agentsStore.offered([]).map((a) => a.id)).toEqual(['claude-code']);
    expect(agentsStore.isOffered('opencode', [])).toBe(false);
    expect(agentsStore.offered(['opencode']).map((a) => a.id)).toEqual(['claude-code', 'opencode']);
    // An agent it doesn't know (the list still loading) isn't held back.
    expect(agentsStore.isOffered('later', [])).toBe(true);
  });

  it("starts new threads on the user's pick when they can use it, else on the registry's default", () => {
    const work = { id: 'claude-account-work', displayName: 'Claude Agent (Work)', capabilities: {}, account: { name: 'Work', configDir: 'C:\\w' } };
    const opencode = { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' as const };
    agentsStore.list = [{ ...claude, isDefault: true }, work, opencode];
    expect(agentsStore.defaultForNew('', [])).toBe('claude-code');
    expect(agentsStore.defaultForNew('claude-account-work', [])).toBe('claude-account-work');
    // An alpha agent turned off, a removed account, or one it doesn't know.
    expect(agentsStore.defaultForNew('opencode', [])).toBe('claude-code');
    expect(agentsStore.defaultForNew('opencode', ['opencode'])).toBe('opencode');
    agentsStore.list = [{ ...claude, isDefault: true }, { ...work, account: { ...work.account, removed: true } }];
    expect(agentsStore.defaultForNew('claude-account-work', [])).toBe('claude-code');
    expect(agentsStore.defaultForNew('gone', [])).toBe('claude-code');
  });

  it('uses the agent marked default, else the first', async () => {
    mockGroveBench.listAdapters.mockResolvedValue([claude, codex]);
    await agentsStore.load();
    expect(agentsStore.defaultId).toBe('codex');

    agentsStore.list = [claude, { ...codex, isDefault: false }];
    expect(agentsStore.defaultId).toBe('claude-code');
  });

  it('lists the agents that support a feature', async () => {
    mockGroveBench.listAdapters.mockResolvedValue([claude, codex]);
    await agentsStore.load();
    expect(agentsStore.supporting('plugins').map((a) => a.id)).toEqual(['claude-code']);
  });

  it('retries on the next call after a failed load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGroveBench.listAdapters.mockRejectedValueOnce(new Error('IPC down')).mockResolvedValue([claude]);
    await agentsStore.load();
    expect(agentsStore.loaded).toBe(false);
    await agentsStore.load();
    expect(agentsStore.list).toEqual([claude]);
    consoleError.mockRestore();
  });
});
