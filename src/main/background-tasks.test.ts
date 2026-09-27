import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentAdapter } from './adapters/types.js';

const adapters: Record<string, Partial<AgentAdapter>> = {};
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    get: (id: string) => adapters[id],
    getDefault: () => adapters['claude-code'],
  },
}));

const settings = { backgroundModels: {} as Record<string, string> };
vi.mock('./settings.js', () => ({ getSettings: () => settings }));

vi.mock('./worktree-manager.js', () => ({
  worktreeManager: { getAdapterType: vi.fn(), list: vi.fn() },
}));

import { agentForProject, backgroundModelFor, newestAgent, recordedAgent } from './background-tasks.js';
import { worktreeManager } from './worktree-manager.js';

const conversation = (id: string, agentType: string | undefined, lastActiveAt?: number, createdAt = 0) =>
  ({ id, agentType, lastActiveAt, createdAt, path: '', branch: id, repoPath: '/repo' });

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(adapters)) delete adapters[key];
  adapters['claude-code'] = { id: 'claude-code', backgroundModel: 'claude-haiku-4-5-20251001', capabilities: { skills: true } as never };
  adapters.codex = { id: 'codex', capabilities: { skills: false } as never };
  settings.backgroundModels = {};
});

describe('backgroundModelFor()', () => {
  it("prefers the user's pick for that agent", () => {
    settings.backgroundModels = { 'claude-code': 'claude-sonnet-4-6', codex: 'codex-mini' };
    expect(backgroundModelFor(adapters['claude-code'] as AgentAdapter)).toBe('claude-sonnet-4-6');
    expect(backgroundModelFor(adapters.codex as AgentAdapter)).toBe('codex-mini');
  });

  it("falls back to the agent's own default, then to none", () => {
    expect(backgroundModelFor(adapters['claude-code'] as AgentAdapter)).toBe('claude-haiku-4-5-20251001');
    expect(backgroundModelFor(adapters.codex as AgentAdapter)).toBeUndefined();
  });

  it("never uses another agent's pick", () => {
    settings.backgroundModels = { 'claude-code': 'claude-sonnet-4-6' };
    expect(backgroundModelFor(adapters.codex as AgentAdapter)).toBeUndefined();
  });
});

describe('recordedAgent()', () => {
  it('returns the agent the conversation ran on', async () => {
    vi.mocked(worktreeManager.getAdapterType).mockResolvedValue('codex');
    expect((await recordedAgent('s1')).id).toBe('codex');
  });

  it('falls back to the default agent for unknown conversations or agents', async () => {
    vi.mocked(worktreeManager.getAdapterType).mockResolvedValue(undefined);
    expect((await recordedAgent('gone')).id).toBe('claude-code');
    vi.mocked(worktreeManager.getAdapterType).mockResolvedValue('removed-agent');
    expect((await recordedAgent('s2')).id).toBe('claude-code');
  });
});

describe('newestAgent()', () => {
  const list = [
    conversation('old', 'claude-code', 1),
    conversation('new', 'codex', 5),
    conversation('fresh', 'claude-code', undefined, 3),
  ];

  it('picks the most recently active conversation', () => {
    expect(newestAgent(list)?.id).toBe('codex');
  });

  it('skips agents the caller rejects', () => {
    expect(newestAgent(list, (a) => (a.capabilities as { skills?: boolean }).skills === true)?.id).toBe('claude-code');
  });

  it('returns null when nothing qualifies', () => {
    expect(newestAgent([])).toBeNull();
    expect(newestAgent([conversation('x', 'removed-agent', 1)])).toBeNull();
  });
});

describe('agentForProject()', () => {
  it("uses the project's newest conversation, else the default agent", async () => {
    vi.mocked(worktreeManager.list).mockResolvedValue([conversation('a', 'codex', 2)] as never);
    expect((await agentForProject('/repo')).id).toBe('codex');
    vi.mocked(worktreeManager.list).mockResolvedValue([]);
    expect((await agentForProject('/empty')).id).toBe('claude-code');
  });
});
