import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';

const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  cp: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));

// Mock git functions to avoid real git calls
vi.mock('./git.js', () => ({
  FETCH_TIMEOUT_MS: 30_000,
  git: vi.fn(),
  excludeFromGit: vi.fn(),
  isGitRepo: vi.fn().mockResolvedValue(true),
  renameBranch: vi.fn(),
  branchHasRemote: vi.fn(),
  validateBranchName: vi.fn(),
  branchExists: vi.fn(),
  getGitIdentity: vi.fn(),
  getDefaultBranch: vi.fn(),
  currentBranch: vi.fn(),
  localBranchExists: vi.fn(),
  remoteTrackingRef: vi.fn(),
  isWorkingTreeClean: vi.fn(),
  worktreeBranches: vi.fn(),
  checkoutBranch: vi.fn(),
}));

vi.mock('./adapters/index.js', () => ({
  adapterRegistry: { get: vi.fn(), getDefault: vi.fn(() => ({ generateSettings: undefined })) },
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFsUtils = vi.hoisted(() => ({
  removeDirectory: vi.fn(),
  removeDirectoryWithRetry: vi.fn(),
  pathExists: vi.fn(),
  // Pass through to the mocked fs so tests can script manifest reads/writes.
  readFileWithRetry: vi.fn((p: string) => mockFs.readFile(p, 'utf-8')),
  writeFileAtomic: vi.fn((p: string, data: string) => mockFs.writeFile(p, data)),
}));
vi.mock('./fs-utils.js', () => mockFsUtils);

import {
  git, excludeFromGit, branchExists, branchHasRemote, getGitIdentity, getDefaultBranch, validateBranchName, currentBranch,
  localBranchExists, remoteTrackingRef, isWorkingTreeClean, worktreeBranches, checkoutBranch,
} from './git.js';
import { WorktreeManager } from './worktree-manager.js';
import { adapterRegistry } from './adapters/index.js';

const mockGit = vi.mocked(git);

let manager: WorktreeManager;
let savedManifest: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  manager = new WorktreeManager();
  savedManifest = {};
  vi.mocked(worktreeBranches).mockResolvedValue(new Map());

  // Default: empty manifest
  mockFs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockFs.writeFile.mockImplementation(async (_path: string, data: string) => {
    savedManifest = JSON.parse(data);
  });
  mockFs.mkdir.mockResolvedValue(undefined);
  vi.mocked(getDefaultBranch).mockResolvedValue('main');
});

describe('saveThreadLimits / getThreadLimits', () => {
  it('records a thread\'s spend and allowance, and drops an allowance it no longer has', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000, threadAllowanceUsd: 9 },
    }));

    await manager.saveThreadLimits('wt-1', { spendUsd: 1.5, allowanceUsd: 3 });
    expect(savedManifest).toEqual({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000, threadSpendUsd: 1.5, threadAllowanceUsd: 3 },
    });

    await manager.saveThreadLimits('wt-1', { spendUsd: 2 });
    expect(savedManifest).toEqual({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000, threadSpendUsd: 2 },
    });
  });

  it('records the thread\'s tokens with its spend', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000 } }));
    await manager.saveThreadLimits('wt-1', { spendUsd: 0, tokens: { input: 1200, output: 80 } });
    expect(savedManifest).toEqual({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000, threadSpendUsd: 0, threadInputTokens: 1200, threadOutputTokens: 80 },
    });
  });

  it('writes nothing for a thread no longer in the manifest', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'a', createdAt: 1 } }));
    await manager.saveThreadLimits('gone', { spendUsd: 2 });
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('reads them back, and nothing for a thread without them or values that are not sums', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-1': { repoPath: '/repo', branch: 'a', createdAt: 1, threadSpendUsd: 1.5, threadAllowanceUsd: 3 },
      'wt-2': { repoPath: '/repo', branch: 'a2', createdAt: 1, threadSpendUsd: 1.5, threadAllowanceUsd: 'more' },
      'wt-old': { repoPath: '/repo', branch: 'b', createdAt: 2 },
      'wt-bad': { repoPath: '/repo', branch: 'c', createdAt: 3, threadSpendUsd: 'lots' },
      'wt-neg': { repoPath: '/repo', branch: 'd', createdAt: 4, threadSpendUsd: -1 },
      'wt-tok': { repoPath: '/repo', branch: 'e', createdAt: 5, threadSpendUsd: 0, threadInputTokens: 1200, threadOutputTokens: 80 },
      'wt-half': { repoPath: '/repo', branch: 'f', createdAt: 6, threadSpendUsd: 0, threadInputTokens: 1200, threadOutputTokens: 'many' },
    }));

    expect(await manager.getThreadLimits('wt-1')).toEqual({ spendUsd: 1.5, allowanceUsd: 3 });
    expect(await manager.getThreadLimits('wt-2')).toEqual({ spendUsd: 1.5 });
    expect(await manager.getThreadLimits('wt-old')).toBeUndefined();
    expect(await manager.getThreadLimits('wt-bad')).toBeUndefined();
    expect(await manager.getThreadLimits('wt-neg')).toBeUndefined();
    expect(await manager.getThreadLimits('wt-tok')).toEqual({ spendUsd: 0, tokens: { input: 1200, output: 80 } });
    expect(await manager.getThreadLimits('wt-half')).toEqual({ spendUsd: 0 });
    expect(await manager.getThreadLimits('missing')).toBeUndefined();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});

describe('saveAdapterType / getAdapterType', () => {
  it('records which agent a session runs', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    await manager.saveAdapterType('wt-1', 'codex');

    expect(savedManifest).toEqual({
      'wt-1': { repoPath: '/repo', branch: 'feature', createdAt: 1000, adapterType: 'codex' },
    });
  });

  it('reads the recorded agent, and treats older entries as Claude Code', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-new': { repoPath: '/repo', branch: 'a', createdAt: 1, adapterType: 'codex' },
      'wt-old': { repoPath: '/repo', branch: 'b', createdAt: 2 },
    }));

    expect(await manager.getAdapterType('wt-new')).toBe('codex');
    expect(await manager.getAdapterType('wt-old')).toBe('claude-code');
    expect(await manager.getAdapterType('missing')).toBeUndefined();
  });

  it('reads the agent and model together, in one read of the manifest', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-new': { repoPath: '/repo', branch: 'a', createdAt: 1, adapterType: 'codex', model: 'o4' },
      'wt-old': { repoPath: '/repo', branch: 'b', createdAt: 2 },
    }));
    mockFs.readFile.mockClear();

    expect(await manager.getAgentAndModel('wt-new')).toEqual({ adapterType: 'codex', model: 'o4' });
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    expect(await manager.getAgentAndModel('wt-old')).toEqual({ adapterType: 'claude-code', model: undefined });
    expect(await manager.getAgentAndModel('missing')).toEqual({});
  });

  it('includes the agent when a stopped session is rebuilt from the manifest', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-codex': { repoPath: '/repo', branch: 'a', createdAt: 1, direct: true, adapterType: 'codex' },
    }));

    expect((await manager.getWorktreeOrManifest('wt-codex'))?.agentType).toBe('codex');
  });
});

describe('saveProviderSessionId / getProviderSessionId', () => {
  it('persists session ID to manifest for existing entry', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    await manager.saveProviderSessionId('wt-123', 'session-abc');

    expect(savedManifest).toEqual({
      'wt-123': {
        repoPath: '/repo',
        branch: 'feature',
        createdAt: 1000,
        providerSessionId: 'session-abc',
      },
    });
  });

  it('does not create entry for unknown worktree ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    await manager.saveProviderSessionId('wt-unknown', 'session-xyz');

    expect(savedManifest['wt-unknown']).toBeUndefined();
    expect((savedManifest as any)['wt-123'].providerSessionId).toBeUndefined();
  });

  it('retrieves persisted session ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, providerSessionId: 'session-456' },
    }));

    const result = await manager.getProviderSessionId('wt-123');
    expect(result).toBe('session-456');
  });

  it('falls back to old claudeSessionId field for migration', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, claudeSessionId: 'old-session' },
    }));

    const result = await manager.getProviderSessionId('wt-123');
    expect(result).toBe('old-session');
  });

  it('prefers providerSessionId over claudeSessionId', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, providerSessionId: 'new', claudeSessionId: 'old' },
    }));

    const result = await manager.getProviderSessionId('wt-123');
    expect(result).toBe('new');
  });

  it('returns undefined for worktree without session ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    const result = await manager.getProviderSessionId('wt-123');
    expect(result).toBeUndefined();
  });

  it('returns undefined for unknown worktree ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({}));

    const result = await manager.getProviderSessionId('nonexistent');
    expect(result).toBeUndefined();
  });

  it('overwrites previous session ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, providerSessionId: 'old-session' },
    }));

    await manager.saveProviderSessionId('wt-123', 'new-session');

    expect((savedManifest as any)['wt-123'].providerSessionId).toBe('new-session');
  });
});

describe('saveDisplayName', () => {
  it('persists display name to manifest for existing entry', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    await manager.saveDisplayName('wt-123', 'My Session');

    expect((savedManifest as any)['wt-123'].displayName).toBe('My Session');
    expect((savedManifest as any)['wt-123'].displayNameSource).toBe('user');
  });

  it('clears the name when passed an empty string', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, displayName: 'Old' },
    }));

    await manager.saveDisplayName('wt-123', '');

    expect((savedManifest as any)['wt-123'].displayName).toBeUndefined();
  });

  it('does not create entry for unknown worktree ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000 },
    }));

    await manager.saveDisplayName('wt-unknown', 'X');

    expect(savedManifest['wt-unknown']).toBeUndefined();
  });
});

describe('getDisplayNameState', () => {
  it('returns the name and its source, with no source for older entries', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-new': { repoPath: '/repo', branch: 'a', createdAt: 1000, displayName: 'Fix sort', displayNameSource: 'auto' },
      'wt-old': { repoPath: '/repo', branch: 'b', createdAt: 1000, displayName: 'can you fix…' },
      'wt-none': { repoPath: '/repo', branch: 'c', createdAt: 1000 },
    }));

    expect(await manager.getDisplayNameState('wt-new')).toEqual({ displayName: 'Fix sort', source: 'auto' });
    expect(await manager.getDisplayNameState('wt-old')).toEqual({ displayName: 'can you fix…', source: undefined });
    expect(await manager.getDisplayNameState('wt-none')).toEqual({ displayName: null, source: undefined });
    expect(await manager.getDisplayNameState('wt-unknown')).toBeUndefined();
  });
});

describe('saveAutoDisplayName', () => {
  it('saves when the name is unchanged since it was read', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, displayName: 'can you fix…' },
    }));

    const saved = await manager.saveAutoDisplayName('wt-123', { displayName: 'can you fix…' }, { displayName: 'Fix sort', source: 'auto' });

    expect(saved).toBe(true);
    expect((savedManifest as any)['wt-123'].displayName).toBe('Fix sort');
    expect((savedManifest as any)['wt-123'].displayNameSource).toBe('auto');
  });

  it('does not overwrite a rename made after the name was read', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, displayName: 'Mine', displayNameSource: 'user' },
    }));

    const saved = await manager.saveAutoDisplayName('wt-123', { displayName: null, source: 'auto' }, { displayName: 'Fix sort', source: 'auto' });

    expect(saved).toBe(false);
    expect((savedManifest as any)['wt-123'].displayName).toBe('Mine');
    expect((savedManifest as any)['wt-123'].displayNameSource).toBe('user');
  });
});

describe('conversation goal', () => {
  it('reads an empty goal for entries without one, and undefined for unknown ids', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-set': { repoPath: '/repo', branch: 'a', createdAt: 1000, goal: 'Fix sort', goalSource: 'auto', goalHidden: true },
      'wt-none': { repoPath: '/repo', branch: 'b', createdAt: 1000 },
    }));

    expect(await manager.getGoal('wt-set')).toEqual({ text: 'Fix sort', source: 'auto', hidden: true });
    expect(await manager.getGoal('wt-none')).toEqual({ text: null, source: null, hidden: false });
    expect(await manager.getGoal('wt-unknown')).toBeUndefined();
  });

  it('reads several goals from one manifest read, leaving out unknown and removed ids', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-set': { repoPath: '/repo', branch: 'a', createdAt: 1000, goal: 'Fix sort', goalSource: 'auto' },
      'wt-none': { repoPath: '/repo', branch: 'b', createdAt: 1000 },
      'wt-gone': { repoPath: '/repo', branch: 'c', createdAt: 1000, goal: 'Old', pendingRemoval: true },
    }));
    mockFs.readFile.mockClear();

    expect(await manager.getGoals(['wt-set', 'wt-none', 'wt-gone', 'wt-unknown'])).toEqual({
      'wt-set': { text: 'Fix sort', source: 'auto', hidden: false },
      'wt-none': { text: null, source: null, hidden: false },
    });
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
  });

  it('saves a typed goal, and an empty one clears the text but keeps the source', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, goal: 'Old', goalSource: 'auto' },
    }));

    expect(await manager.saveGoal('wt-123', 'Mine', 'user')).toEqual({ text: 'Mine', source: 'user', hidden: false });
    expect((savedManifest as any)['wt-123'].goal).toBe('Mine');

    mockFs.readFile.mockResolvedValue(JSON.stringify(savedManifest));
    expect(await manager.saveGoal('wt-123', '', 'user')).toEqual({ text: null, source: 'user', hidden: false });
    expect((savedManifest as any)['wt-123'].goal).toBeUndefined();
    expect((savedManifest as any)['wt-123'].goalSource).toBe('user');
  });

  it('does not overwrite an edit made while a goal was being generated', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, goal: 'Mine', goalSource: 'user' },
    }));

    const saved = await manager.saveGoal('wt-123', 'Generated', 'auto', { text: null, source: null, hidden: false });

    expect(saved).toBeNull();
    // Nothing changed, so the manifest isn't rewritten.
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('hides and shows the bar without touching the goal, and ignores unknown ids', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, goal: 'Fix sort', goalSource: 'auto' },
    }));

    expect(await manager.setGoalHidden('wt-123', true)).toEqual({ text: 'Fix sort', source: 'auto', hidden: true });
    mockFs.readFile.mockResolvedValue(JSON.stringify(savedManifest));
    expect(await manager.setGoalHidden('wt-123', false)).toEqual({ text: 'Fix sort', source: 'auto', hidden: false });
    expect((savedManifest as any)['wt-123'].goalHidden).toBeUndefined();
    mockFs.readFile.mockResolvedValue(JSON.stringify(savedManifest));
    mockFs.writeFile.mockClear();
    expect(await manager.setGoalHidden('wt-123', false)).toEqual({ text: 'Fix sort', source: 'auto', hidden: false });
    expect(await manager.setGoalHidden('wt-unknown', true)).toBeNull();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});

describe('migration from claudeSessionId', () => {
  it('getProviderSessionId falls back to claudeSessionId for old manifests', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-123': { repoPath: '/repo', branch: 'feature', createdAt: 1000, claudeSessionId: 'old-session' },
    }));

    const result = await manager.getProviderSessionId('wt-123');
    expect(result).toBe('old-session');
  });
});

describe('remove', () => {
  const manifest = {
    'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000 },
    'wt-b': { repoPath: '/repo', branch: 'feat-b', createdAt: 2000 },
  };

  it('removes worktree from manifest and calls git worktree remove', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));
    mockGit.mockResolvedValue('');
    mockFs.readdir.mockResolvedValue(['wt-b']);

    await manager.remove('wt-a');

    expect(mockGit).toHaveBeenCalledWith(
      ['worktree', 'remove', expect.stringContaining('wt-a')],
      '/repo',
    );
    expect(savedManifest).not.toHaveProperty('wt-a');
    expect(savedManifest).toHaveProperty('wt-b');
  });

  it('is a no-op for unknown worktree ID', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));

    await manager.remove('nonexistent');

    expect(mockGit).not.toHaveBeenCalled();
  });

  it('falls back to force remove when normal remove fails', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));
    mockGit
      .mockRejectedValueOnce(new Error('locked'))   // normal remove fails
      .mockResolvedValueOnce('')                     // force remove succeeds
      .mockResolvedValue('');                        // any further calls
    mockFs.readdir.mockResolvedValue(['wt-b']);

    await manager.remove('wt-a');

    expect(mockGit).toHaveBeenCalledWith(
      ['worktree', 'remove', '--force', expect.stringContaining('wt-a')],
      '/repo',
    );
  });

  it('deletes branch when deleteBranch is true', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));
    mockGit.mockResolvedValue('');
    mockFs.readdir.mockResolvedValue([]);

    await manager.remove('wt-a', true);

    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'feat-a'], '/repo');
  });

  it('serializes concurrent removes on the same repo', async () => {
    // Use a live manifest object so reads reflect prior writes
    let liveManifest = { ...manifest };
    mockFs.readFile.mockImplementation(async () => JSON.stringify(liveManifest));
    mockFs.writeFile.mockImplementation(async (_path: string, data: string) => {
      liveManifest = JSON.parse(data);
      savedManifest = liveManifest;
    });
    mockFs.readdir.mockResolvedValue([]);

    // Track the order of git worktree remove calls to verify serialization
    const callOrder: string[] = [];
    mockGit.mockImplementation(async (args: string[]) => {
      const id = args[0] === 'worktree' ? args[2] : args[1]; // extract path or branch
      callOrder.push(`start:${args[0]}:${id}`);
      // Simulate async work so interleaving would be visible
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push(`end:${args[0]}:${id}`);
      return '';
    });

    // Fire both removes concurrently
    await Promise.all([
      manager.remove('wt-a'),
      manager.remove('wt-b'),
    ]);

    // Both should complete
    expect(savedManifest).not.toHaveProperty('wt-a');
    expect(savedManifest).not.toHaveProperty('wt-b');

    // Verify serialization: the second worktree remove starts only after the
    // first has ended (either order is fine, but they must not overlap)
    const [first, second] = callOrder
      .filter((e) => e.startsWith('start:worktree:'))
      .map((e) => e.slice('start:worktree:'.length)); // a Windows path has its own ':'
    expect(second).toBeDefined();
    expect(callOrder.indexOf(`start:worktree:${second}`))
      .toBeGreaterThan(callOrder.indexOf(`end:worktree:${first}`));
  });

  it('cleans up empty repoHash directory', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-only': { repoPath: '/repo', branch: 'feat', createdAt: 1000 },
    }));
    mockGit.mockResolvedValue('');
    // Only config.json and .npm-cache remain — treated as empty
    mockFs.readdir.mockResolvedValue(['config.json', '.npm-cache']);
    mockFs.rm.mockResolvedValue(undefined);

    await manager.remove('wt-only');

    expect(mockFs.rm).toHaveBeenCalledWith(
      expect.stringContaining('worktrees'),
      { recursive: true, force: true },
    );
  });

  it('retries the raw delete when both git removes fail', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));
    mockGit
      .mockRejectedValueOnce(new Error('locked'))   // worktree remove
      .mockRejectedValueOnce(new Error('locked'))   // worktree remove --force
      .mockResolvedValue('');                        // prune, branch ops
    mockFsUtils.removeDirectoryWithRetry.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue(['wt-b']);

    await manager.remove('wt-a');

    expect(mockFsUtils.removeDirectoryWithRetry).toHaveBeenCalledWith(expect.stringContaining('wt-a'));
    expect(mockGit).toHaveBeenCalledWith(['worktree', 'prune'], '/repo');
    expect(savedManifest).not.toHaveProperty('wt-a');
  });

  it('keeps a hidden manifest entry when the directory stays locked', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...manifest }));
    mockGit.mockRejectedValue(new Error('locked'));
    mockFsUtils.removeDirectoryWithRetry.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));

    await manager.remove('wt-a', true);

    expect((savedManifest as any)['wt-a']).toMatchObject({
      repoPath: '/repo',
      pendingRemoval: true,
      pendingBranchDelete: true,
    });
    // Branch deletion is deferred too: it would fail while the worktree still holds it
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-d', 'feat-a'], '/repo');
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'feat-a'], '/repo');
  });
});

describe('pending removals', () => {
  const pendingManifest = {
    'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000, pendingRemoval: true, pendingBranchDelete: true },
    'wt-b': { repoPath: '/repo', branch: 'feat-b', createdAt: 2000 },
  };

  it('hides pending-removal entries from list() and listRepos()', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/gone', branch: 'feat-a', createdAt: 1000, pendingRemoval: true },
      'wt-b': { repoPath: '/repo', branch: 'feat-b', createdAt: 2000 },
    }));
    mockGit.mockResolvedValue('worktree /mock/userData/worktrees/x/wt-b\nbranch refs/heads/feat-b\n');

    expect(await manager.listRepos()).toEqual(['/repo']);
    expect(await manager.getWorktreeOrManifest('wt-a')).toBeUndefined();
  });

  it('processPendingRemovals deletes the directory, prunes, drops the branch and the entry', async () => {
    let liveManifest: Record<string, unknown> = { ...pendingManifest };
    mockFs.readFile.mockImplementation(async () => JSON.stringify(liveManifest));
    mockFs.writeFile.mockImplementation(async (_path: string, data: string) => {
      liveManifest = JSON.parse(data);
      savedManifest = liveManifest;
    });
    mockFsUtils.pathExists.mockResolvedValue(true);
    mockFsUtils.removeDirectory.mockResolvedValue(undefined);
    mockGit.mockResolvedValue('');

    const cleaned = await manager.processPendingRemovals();

    expect(cleaned).toBe(1);
    expect(mockFsUtils.removeDirectory).toHaveBeenCalledWith(expect.stringContaining('wt-a'));
    expect(mockGit).toHaveBeenCalledWith(['worktree', 'prune'], '/repo');
    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'feat-a'], '/repo');
    expect(savedManifest).not.toHaveProperty('wt-a');
    expect(savedManifest).toHaveProperty('wt-b');
  });

  it('processPendingRemovals leaves the entry for the next sweep when still locked', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ ...pendingManifest }));
    mockFsUtils.pathExists.mockResolvedValue(true);
    mockFsUtils.removeDirectory.mockRejectedValue(new Error('EBUSY'));
    mockGit.mockResolvedValue('');

    const cleaned = await manager.processPendingRemovals();

    expect(cleaned).toBe(0);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});

describe('registerDirect (direct sessions, and older attached ones)', () => {
  it('runs on the repo checkout and persists no explicit path for a plain direct session', async () => {
    const info = await manager.registerDirect('/repo', 'main');

    expect(info.direct).toBe(true);
    expect(info.path).toBe('/repo');
    // Plain direct sessions derive their path from repoPath, so it isn't stored.
    expect(savedManifest[info.id]).toEqual({
      repoPath: '/repo',
      branch: 'main',
      createdAt: info.createdAt,
      direct: true,
    });
  });

  it('does not touch git when an older attached session is destroyed (shared worktree is preserved)', async () => {
    // New conversations can no longer attach, but older manifests still hold some.
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-attached': { repoPath: '/repo', branch: 'feature-x', createdAt: 1000, direct: true, path: '/worktrees/abc/wt-src' },
    }));
    mockGit.mockClear();

    await manager.remove('wt-attached');

    // No worktree remove / branch delete / prune — the worktree belongs to the
    // source session, not this attached one.
    expect(mockGit).not.toHaveBeenCalled();
    expect(savedManifest).not.toHaveProperty('wt-attached');
  });

  it('records a conversation in a folder without git, and keeps that after restart', async () => {
    const info = await manager.registerDirect('/notes', '', { noGit: true });
    expect(info.noGit).toBe(true);
    expect(savedManifest[info.id]).toMatchObject({ repoPath: '/notes', branch: '', direct: true, noGit: true });

    mockFs.readFile.mockResolvedValue(JSON.stringify(savedManifest));
    const restarted = new WorktreeManager();
    expect((await restarted.getWorktreeOrManifest(info.id))?.noGit).toBe(true);
  });

  it('lists a folder project\'s conversations even though git fails there', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-folder': { repoPath: '/notes', branch: '', createdAt: 1000, direct: true, noGit: true },
    }));
    mockGit.mockRejectedValue(new Error('fatal: not a git repository'));

    const listed = await manager.list('/notes');

    expect(listed).toEqual([expect.objectContaining({ id: 'wt-folder', path: '/notes', direct: true, noGit: true })]);
  });

  it('reconstructs the shared worktree path from the manifest after restart', async () => {
    const wtPath = '/worktrees/abc/wt-src';
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-attached': { repoPath: '/repo', branch: 'feature-x', createdAt: 1000, direct: true, path: wtPath },
    }));

    const info = await manager.getWorktreeOrManifest('wt-attached');

    expect(info?.path).toBe(wtPath);
    expect(info?.branch).toBe('feature-x');
    expect(info?.direct).toBe(true);
  });
});

describe("create: the agent's generated files", () => {
  beforeEach(() => {
    mockFsUtils.pathExists.mockResolvedValue(false);
    vi.mocked(branchExists).mockResolvedValue(false);
    vi.mocked(branchHasRemote).mockResolvedValue(false);
    mockGit.mockResolvedValue('');
  });

  it("writes the agent's settings, then keeps them out of git", async () => {
    const generateWorktreeSettings = vi.fn().mockResolvedValue(undefined);
    vi.mocked(adapterRegistry.getDefault).mockReturnValueOnce({
      id: 'claude-code', generateWorktreeSettings, generatedFiles: ['.claude/settings.local.json'],
    } as never);
    const info = await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(generateWorktreeSettings).toHaveBeenCalledWith(info.path, '/repo');
    expect(excludeFromGit).toHaveBeenCalledWith(info.path, ['.claude/settings.local.json']);
  });

  it('still creates the worktree when the exclude list cannot be written', async () => {
    vi.mocked(adapterRegistry.getDefault).mockReturnValueOnce({
      id: 'claude-code', generateWorktreeSettings: vi.fn(), generatedFiles: ['.claude/settings.local.json'],
    } as never);
    vi.mocked(excludeFromGit).mockRejectedValueOnce(new Error('read-only'));
    await expect(manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' })).resolves.toMatchObject({ id: 'a1' });
  });
});

describe('create — pulling the base branch', () => {
  const wtAddCall = () => mockGit.mock.calls.find((c) => c[0][0] === 'worktree' && c[0][1] === 'add');
  const calledWith = (...prefix: string[]) =>
    mockGit.mock.calls.some((c) => prefix.every((p, i) => c[0][i] === p));

  /** Drive git responses by command prefix; unmatched commands resolve to ''. */
  function scriptGit(handlers: Record<string, () => Promise<string> | string>) {
    mockGit.mockImplementation(async (args: string[]) => {
      for (const [key, fn] of Object.entries(handlers)) {
        if (args.join(' ').startsWith(key)) return fn();
      }
      return '';
    });
  }

  beforeEach(() => {
    mockFsUtils.pathExists.mockResolvedValue(false);
    vi.mocked(branchExists).mockResolvedValue(false);
    vi.mocked(branchHasRemote).mockResolvedValue(true);
  });

  it('skips the network entirely when the base branch has no remote', async () => {
    vi.mocked(branchHasRemote).mockResolvedValue(false);
    scriptGit({});
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(calledWith('fetch')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('fetches origin with a timeout and falls back to the local branch when offline', async () => {
    scriptGit({ 'fetch origin main': () => { throw new Error('network down'); } });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(mockGit).toHaveBeenCalledWith(['fetch', 'origin', 'main'], '/repo', { timeout: expect.any(Number) });
    expect(calledWith('merge')).toBe(false);
    expect(calledWith('branch', '-f')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('leaves the local branch alone when it already contains origin', async () => {
    // origin/main is an ancestor of main → up to date (or ahead)
    scriptGit({ 'merge-base --is-ancestor origin/main main': () => '' });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(calledWith('merge', '--ff-only')).toBe(false);
    expect(calledWith('branch', '-f')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('fast-forwards the checked-out base branch in the main repo when it is behind', async () => {
    scriptGit({
      'merge-base --is-ancestor origin/main main': () => { throw new Error('exit 1'); },
      'merge-base --is-ancestor main origin/main': () => '',
      'symbolic-ref --short -q HEAD': () => 'main\n',
    });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(mockGit).toHaveBeenCalledWith(['merge', '--ff-only', 'origin/main'], '/repo');
    expect(calledWith('branch', '-f')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('branches from the fetched origin commit when the checked-out base cannot be fast-forwarded', async () => {
    scriptGit({
      'merge-base --is-ancestor origin/main main': () => { throw new Error('exit 1'); },
      'merge-base --is-ancestor main origin/main': () => '',
      'symbolic-ref --short -q HEAD': () => 'main\n',
      'merge --ff-only origin/main': () => { throw new Error('local changes would be overwritten'); },
      'rev-parse --verify origin/main^{commit}': () => 'abcdef1234567890\n',
    });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'abcdef1234567890']);
  });

  it('moves a base branch that is not checked out anywhere with branch -f', async () => {
    scriptGit({
      'merge-base --is-ancestor origin/main main': () => { throw new Error('exit 1'); },
      'merge-base --is-ancestor main origin/main': () => '',
      'symbolic-ref --short -q HEAD': () => 'other\n',
      'worktree list --porcelain': () => 'worktree /repo\nHEAD 111\nbranch refs/heads/other\n',
    });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(mockGit).toHaveBeenCalledWith(['branch', '-f', 'main', 'origin/main'], '/repo');
    expect(calledWith('merge', '--ff-only')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('does not touch a base branch checked out in another worktree; branches from origin instead', async () => {
    scriptGit({
      'merge-base --is-ancestor origin/main main': () => { throw new Error('exit 1'); },
      'merge-base --is-ancestor main origin/main': () => '',
      'symbolic-ref --short -q HEAD': () => 'other\n',
      'worktree list --porcelain': () =>
        'worktree /repo\nHEAD 111\nbranch refs/heads/other\n\nworktree /wt/x\nHEAD 222\nbranch refs/heads/main\n',
      'rev-parse --verify origin/main^{commit}': () => 'fedcba0987654321\n',
    });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(calledWith('branch', '-f')).toBe(false);
    expect(calledWith('merge', '--ff-only')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'fedcba0987654321']);
  });

  it('keeps the local branch when it has diverged from origin', async () => {
    scriptGit({
      'merge-base --is-ancestor': () => { throw new Error('exit 1'); },
    });
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect(calledWith('merge', '--ff-only')).toBe(false);
    expect(calledWith('branch', '-f')).toBe(false);
    expect(calledWith('rev-parse')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', '-b', 'feat', expect.any(String), 'main']);
  });

  it('does not pull anything when reusing an existing branch', async () => {
    scriptGit({});
    await manager.create({ repoPath: '/repo', branchName: 'feat', useExisting: true, id: 'a1' });
    expect(calledWith('fetch')).toBe(false);
    expect(wtAddCall()?.[0]).toEqual(['worktree', 'add', expect.any(String), 'feat']);
  });

  it('records the branch it creates, and not one it reuses', async () => {
    scriptGit({});
    await manager.create({ repoPath: '/repo', branchName: 'feat', baseBranch: 'main', id: 'a1' });
    expect((savedManifest['a1'] as { createdBranches?: string[] }).createdBranches).toEqual(['feat']);
    await manager.create({ repoPath: '/repo', branchName: 'old', useExisting: true, id: 'a2' });
    expect(savedManifest['a2']).not.toHaveProperty('createdBranches');
  });
});

describe('create: git identity', () => {
  beforeEach(() => {
    mockFsUtils.pathExists.mockResolvedValue(false);
    vi.mocked(branchExists).mockResolvedValue(false);
    vi.mocked(branchHasRemote).mockResolvedValue(false);
    // An identity is available, so nothing stops create() from copying it.
    vi.mocked(getGitIdentity).mockResolvedValue({ name: 'u', email: 'u@x' });
    mockGit.mockResolvedValue('');
  });

  // `git config` inside a linked worktree writes the repo's shared .git/config,
  // which would pin whatever identity was in effect into the user's repo.
  // Agent commits get the identity from GIT_AUTHOR_*/GIT_COMMITTER_* env vars.
  it.each([
    ['a new branch', { baseBranch: 'main' }],
    ['an existing branch', { useExisting: true }],
  ])('does not write user.name or user.email when creating a worktree on %s', async (_label, opts) => {
    await manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1', ...opts });
    expect(mockGit).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'add']), '/repo');
    const identityCalls = mockGit.mock.calls.filter(([args]) =>
      args.some((a) => a === 'user.name' || a === 'user.email'),
    );
    expect(identityCalls).toEqual([]);
  });
});

describe('remove with conversations attached to the worktree', () => {
  const WT = '/worktrees/abc/wt-a';

  beforeEach(() => {
    mockFs.readFile.mockImplementation(async () => JSON.stringify(savedManifest));
    savedManifest = { 'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000, path: WT } };
    manager.register({ id: 'wt-a', path: WT, branch: 'feat-a', repoPath: '/repo', createdAt: 1000 });
  });

  it('refuses to remove the worktree, or delete its branch, while another conversation uses it', async () => {
    // Older versions could attach a second conversation to a worktree; one
    // loaded from such a manifest shares its path.
    const attached = { id: 'att-1', path: WT, branch: 'feat-a', repoPath: '/repo', createdAt: 2000, direct: true };
    savedManifest = { ...savedManifest, 'att-1': { repoPath: '/repo', branch: 'feat-a', createdAt: 2000, direct: true, path: WT } };
    manager.register(attached);
    mockGit.mockClear();

    await expect(manager.remove('wt-a', true)).rejects.toThrow(/Another thread is still working in this thread's worktree/);
    await expect(manager.assertRemovable('wt-a')).rejects.toThrow();
    expect(mockGit).not.toHaveBeenCalled();
    expect(savedManifest).toHaveProperty('wt-a');

    // Once the attached one is gone, it can go.
    await manager.remove(attached.id);
    await expect(manager.assertRemovable('wt-a')).resolves.toBeUndefined();
  });

  it('sees an attached conversation that is only in the manifest (not loaded this run)', async () => {
    savedManifest = {
      ...savedManifest,
      'att-1': { repoPath: '/repo', branch: 'feat-a', createdAt: 2000, direct: true, path: WT },
    };
    await expect(manager.assertRemovable('wt-a')).rejects.toThrow();
  });

  it('lets an attached conversation go without touching the shared worktree', async () => {
    const attached = { id: 'att-1', path: WT, branch: 'feat-a', repoPath: '/repo', createdAt: 2000, direct: true };
    manager.register(attached);
    await expect(manager.assertRemovable(attached.id)).resolves.toBeUndefined();
  });
});

describe('switchBranch', () => {
  const WT = '/worktrees/abc/wt-a';

  beforeEach(() => {
    // Round-trip the manifest so registerDirect and switchBranch see each other's writes.
    mockFs.readFile.mockImplementation(async () => JSON.stringify(savedManifest));
    vi.mocked(validateBranchName).mockResolvedValue(true);
    vi.mocked(currentBranch).mockResolvedValue('feat-a');
    vi.mocked(localBranchExists).mockResolvedValue(true);
    vi.mocked(remoteTrackingRef).mockResolvedValue(null);
    vi.mocked(isWorkingTreeClean).mockResolvedValue(true);
    vi.mocked(worktreeBranches).mockResolvedValue(new Map([['main', '/repo'], ['feat-a', WT]]));
    vi.mocked(checkoutBranch).mockResolvedValue(undefined);
  });

  /** A worktree conversation on `feat-a`, in memory and in the manifest. */
  function addWorktreeSession() {
    savedManifest = { 'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000 } };
    manager.register({ id: 'wt-a', path: WT, branch: 'feat-a', repoPath: '/repo', createdAt: 1000 });
  }

  it('checks out an existing local branch and records it', async () => {
    addWorktreeSession();

    const result = await manager.switchBranch('wt-a', 'feat-b');

    expect(result).toEqual({ success: true, branch: 'feat-b', sessionIds: ['wt-a'] });
    expect(checkoutBranch).toHaveBeenCalledWith(WT, 'feat-b', { create: false, track: undefined });
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-b');
    expect((savedManifest['wt-a'] as { branch: string }).branch).toBe('feat-b');
  });

  it('creates a tracking branch for a branch that only exists on a remote', async () => {
    addWorktreeSession();
    vi.mocked(localBranchExists).mockResolvedValue(false);
    vi.mocked(remoteTrackingRef).mockResolvedValue('origin/feat-r');

    const result = await manager.switchBranch('wt-a', 'feat-r');

    expect(result.success).toBe(true);
    expect(checkoutBranch).toHaveBeenCalledWith(WT, 'feat-r', { create: false, track: 'origin/feat-r' });
  });

  it('refuses a branch that exists nowhere', async () => {
    addWorktreeSession();
    vi.mocked(localBranchExists).mockResolvedValue(false);

    const result = await manager.switchBranch('wt-a', 'ghost');

    expect(result).toEqual({ success: false, error: 'Branch "ghost" doesn\'t exist.' });
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it('refuses to switch with uncommitted changes', async () => {
    addWorktreeSession();
    vi.mocked(isWorkingTreeClean).mockResolvedValue(false);

    const result = await manager.switchBranch('wt-a', 'feat-b');

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/uncommitted changes/);
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-a');
  });

  it("doesn't count untracked files, such as Grove's own .claude/settings.local.json", async () => {
    addWorktreeSession();

    await manager.switchBranch('wt-a', 'feat-b');

    expect(isWorkingTreeClean).toHaveBeenCalledWith(WT, { ignoreUntracked: true });
  });

  it('records a branch created from the picker as Grove-created', async () => {
    addWorktreeSession();
    (savedManifest['wt-a'] as { createdBranches?: string[] }).createdBranches = ['feat-a'];
    vi.mocked(localBranchExists).mockResolvedValue(false);

    await manager.switchBranch('wt-a', 'feat-new', { create: true });
    expect((savedManifest['wt-a'] as { createdBranches?: string[] }).createdBranches).toEqual(['feat-a', 'feat-new']);

    // Switching onto an existing branch doesn't make it Grove's
    vi.mocked(localBranchExists).mockResolvedValue(true);
    vi.mocked(currentBranch).mockResolvedValue('feat-new');
    await manager.switchBranch('wt-a', 'release');
    expect((savedManifest['wt-a'] as { createdBranches?: string[] }).createdBranches).toEqual(['feat-a', 'feat-new']);
  });

  it('creates a new branch at HEAD even with uncommitted changes', async () => {
    addWorktreeSession();
    vi.mocked(localBranchExists).mockResolvedValue(false);
    vi.mocked(isWorkingTreeClean).mockResolvedValue(false);

    const result = await manager.switchBranch('wt-a', 'feat-new', { create: true });

    expect(result).toEqual({ success: true, branch: 'feat-new', sessionIds: ['wt-a'] });
    expect(checkoutBranch).toHaveBeenCalledWith(WT, 'feat-new', { create: true, track: undefined });
  });

  it('refuses to create a branch that already exists', async () => {
    addWorktreeSession();

    const result = await manager.switchBranch('wt-a', 'feat-b', { create: true });

    expect(result).toEqual({ success: false, error: 'A branch named "feat-b" already exists.' });
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it('refuses a branch checked out in another worktree', async () => {
    addWorktreeSession();

    const result = await manager.switchBranch('wt-a', 'main');

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toContain('/repo');
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it('returns git failures as an error instead of throwing', async () => {
    addWorktreeSession();
    vi.mocked(isWorkingTreeClean).mockRejectedValue(Object.assign(new Error('failed'), { stderr: 'fatal: index file corrupt\n' }));

    const result = await manager.switchBranch('wt-a', 'feat-b');

    expect(result).toEqual({ success: false, error: 'fatal: index file corrupt' });
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-a');
  });

  it('refuses an invalid branch name', async () => {
    addWorktreeSession();
    vi.mocked(validateBranchName).mockResolvedValue(false);

    const result = await manager.switchBranch('wt-a', 'bad..name');

    expect(result.success).toBe(false);
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it('only updates the record when the checkout is already on the branch', async () => {
    addWorktreeSession();
    // The agent switched to feat-b in its own shell; the record still says feat-a.
    vi.mocked(currentBranch).mockResolvedValue('feat-b');

    const result = await manager.switchBranch('wt-a', 'feat-b');

    expect(result).toEqual({ success: true, branch: 'feat-b', sessionIds: ['wt-a'] });
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-b');
  });

  it('moves every conversation sharing the checkout, and no others', async () => {
    addWorktreeSession();
    const a = await manager.registerDirect('/repo', 'main');
    const b = await manager.registerDirect('/repo', 'main');
    vi.mocked(currentBranch).mockResolvedValue('main');
    vi.mocked(worktreeBranches).mockResolvedValue(new Map([['main', '/repo'], ['feat-a', WT]]));

    const result = await manager.switchBranch(a.id, 'develop');

    expect(result.success).toBe(true);
    expect(result.success && [...result.sessionIds].sort()).toEqual([a.id, b.id].sort());
    expect(manager.getWorktree(b.id)?.branch).toBe('develop');
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-a');
    expect((savedManifest[b.id] as { branch: string }).branch).toBe('develop');
    expect((savedManifest['wt-a'] as { branch: string }).branch).toBe('feat-a');
  });

  it('refuses while a conversation sharing the checkout is mid-turn', async () => {
    const a = await manager.registerDirect('/repo', 'main');
    const b = await manager.registerDirect('/repo', 'main');

    const result = await manager.switchBranch(a.id, 'develop', { busySessionIds: [b.id] });

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/agent is working/);
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it('ignores busy conversations on other checkouts', async () => {
    addWorktreeSession();
    const direct = await manager.registerDirect('/repo', 'main');

    const result = await manager.switchBranch('wt-a', 'feat-b', { busySessionIds: [direct.id] });

    expect(result.success).toBe(true);
  });
});

describe('remove: which branches go', () => {
  const unmerged = (branch: string) => (args: string[]) =>
    args[0] === 'branch' && args[1] === '-d' && args[2] === branch
      ? Promise.reject(new Error(`error: the branch '${branch}' is not fully merged`))
      : Promise.resolve('');

  beforeEach(() => {
    mockFs.readdir.mockResolvedValue([]);
  });

  it("never force-deletes a branch the conversation switched onto", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'release/1.4', createdAt: 1000, createdBranches: ['claude/foo'] },
    }));
    mockGit.mockImplementation(unmerged('release/1.4'));

    await manager.remove('wt-a', true);

    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'release/1.4'], '/repo');
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'release/1.4'], '/repo');
    // The branch Grove made is cleaned up too, but only if merged
    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'claude/foo'], '/repo');
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'claude/foo'], '/repo');
  });

  it("force-deletes the conversation's own branch when it has unmerged work", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'claude/foo', createdAt: 1000, createdBranches: ['claude/foo'] },
    }));
    mockGit.mockImplementation(unmerged('claude/foo'));

    await manager.remove('wt-a', true);

    expect(mockGit).toHaveBeenCalledWith(['branch', '-D', 'claude/foo'], '/repo');
  });

  it('only safe-deletes on entries from before created branches were recorded', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000 },
    }));
    mockGit.mockImplementation(unmerged('feat-a'));

    await manager.remove('wt-a', true);

    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'feat-a'], '/repo');
  });

  it('keeps a created branch that another conversation has checked out', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'claude/foo', createdAt: 1000, createdBranches: ['claude/foo', 'claude/bar'] },
    }));
    mockGit.mockResolvedValue('');
    vi.mocked(worktreeBranches).mockResolvedValue(new Map([['claude/bar', '/elsewhere']]));

    await manager.remove('wt-a', true);

    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'claude/foo'], '/repo');
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-d', 'claude/bar'], '/repo');
  });

  it('applies the same rules to deferred removals', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'release/1.4', createdAt: 1000, createdBranches: ['claude/foo'], pendingRemoval: true, pendingBranchDelete: true },
    }));
    mockFsUtils.pathExists.mockResolvedValue(false);
    mockGit.mockImplementation(unmerged('release/1.4'));

    await manager.processPendingRemovals();

    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'release/1.4'], '/repo');
  });
});

describe('syncBranch', () => {
  const WT = '/worktrees/abc/wt-a';

  beforeEach(() => {
    mockFs.readFile.mockImplementation(async () => JSON.stringify(savedManifest));
    vi.mocked(currentBranch).mockResolvedValue('feat-a');
  });

  function addWorktreeSession() {
    savedManifest = { 'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000 } };
    manager.register({ id: 'wt-a', path: WT, branch: 'feat-a', repoPath: '/repo', createdAt: 1000 });
  }

  it('records the branch the agent checked out in its own shell', async () => {
    addWorktreeSession();
    vi.mocked(currentBranch).mockResolvedValue('feat-b');

    const result = await manager.syncBranch('wt-a');

    expect(result).toEqual({ branch: 'feat-b', sessionIds: ['wt-a'] });
    expect(currentBranch).toHaveBeenCalledWith(WT);
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-b');
    expect((savedManifest['wt-a'] as { branch: string }).branch).toBe('feat-b');
  });

  it('does nothing when the checkout is still on the recorded branch', async () => {
    addWorktreeSession();

    expect(await manager.syncBranch('wt-a')).toBeNull();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('keeps the recorded branch while HEAD is detached (e.g. mid-rebase)', async () => {
    addWorktreeSession();
    vi.mocked(currentBranch).mockResolvedValue(null);

    expect(await manager.syncBranch('wt-a')).toBeNull();
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-a');
  });

  it('returns null for a conversation that is not active', async () => {
    expect(await manager.syncBranch('nope')).toBeNull();
    expect(currentBranch).not.toHaveBeenCalled();
  });

  it('moves every conversation sharing the checkout, and no others', async () => {
    addWorktreeSession();
    const a = await manager.registerDirect('/repo', 'main');
    const b = await manager.registerDirect('/repo', 'main');
    vi.mocked(currentBranch).mockImplementation(async (cwd) => (cwd === '/repo' ? 'develop' : 'feat-a'));

    const result = await manager.syncBranch(a.id);

    expect(result?.branch).toBe('develop');
    expect([...(result?.sessionIds ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(manager.getWorktree(b.id)?.branch).toBe('develop');
    expect(manager.getWorktree('wt-a')?.branch).toBe('feat-a');
    expect((savedManifest[b.id] as { branch: string }).branch).toBe('develop');
    expect((savedManifest['wt-a'] as { branch: string }).branch).toBe('feat-a');
  });
});

describe('remove: default branch guard', () => {
  it('never deletes the default branch, even when the conversation switched onto it', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'main', createdAt: 1000 },
    }));
    mockGit.mockResolvedValue('');
    mockFs.readdir.mockResolvedValue([]);

    await manager.remove('wt-a', true);

    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-d', 'main'], '/repo');
    expect(mockGit).not.toHaveBeenCalledWith(['branch', '-D', 'main'], '/repo');
  });

  it('still deletes other branches', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      'wt-a': { repoPath: '/repo', branch: 'feat-a', createdAt: 1000 },
    }));
    mockGit.mockResolvedValue('');
    mockFs.readdir.mockResolvedValue([]);

    await manager.remove('wt-a', true);

    expect(mockGit).toHaveBeenCalledWith(['branch', '-d', 'feat-a'], '/repo');
  });
});

describe('manifest in memory', () => {
  const entry = (branch: string) => ({ repoPath: '/repo', branch, createdAt: 1 });
  /** Make the next manifest write wait until `finish` is called. */
  function holdNextWrite(): { finish: (err?: Error) => void } {
    let finish!: (err?: Error) => void;
    mockFs.writeFile.mockImplementationOnce((_path: string, data: string) => new Promise<void>((resolve, reject) => {
      finish = (err) => {
        if (err) return reject(err);
        savedManifest = JSON.parse(data);
        resolve();
      };
    }));
    return { finish: (err) => finish(err) };
  }

  it('reads the file once, however many ask at the same time', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { ...entry('a'), model: 'opus' } }));

    const [model, agent, limits] = await Promise.all([
      manager.getModel('wt-1'), manager.getAdapterType('wt-1'), manager.getThreadLimits('wt-1'),
    ]);
    await manager.getProviderSessionId('wt-1');

    expect([model, agent, limits]).toEqual(['opus', 'claude-code', undefined]);
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
  });

  it('reads the file again after a read that failed', async () => {
    mockFs.readFile.mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { ...entry('a'), model: 'opus' } }));

    await expect(manager.getModel('wt-1')).rejects.toThrow('Could not read the worktree manifest');
    expect(await manager.getModel('wt-1')).toBe('opus');
  });

  it('a read sees a save still being written, without waiting for it', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': entry('a') }));
    const write = holdNextWrite();

    const saving = manager.saveThreadLimits('wt-1', { spendUsd: 2.5 });
    expect(await manager.getThreadLimits('wt-1')).toEqual({ spendUsd: 2.5 });

    write.finish();
    await saving;
    expect(savedManifest).toEqual({ 'wt-1': { ...entry('a'), threadSpendUsd: 2.5 } });

    // And once the manifest is in memory, the same holds for the next save.
    const next = holdNextWrite();
    const savingMore = manager.saveThreadLimits('wt-1', { spendUsd: 4 });
    expect(await manager.getThreadLimits('wt-1')).toEqual({ spendUsd: 4 });
    next.finish();
    await savingMore;
  });

  it('changes made while a write is under way go in one write', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': entry('a'), 'wt-2': entry('b') }));
    const write = holdNextWrite();

    const first = manager.saveModel('wt-1', 'opus');
    await vi.waitFor(() => expect(mockFs.writeFile).toHaveBeenCalledTimes(1));
    const rest = [
      manager.saveModel('wt-2', 'sonnet'),
      manager.saveProviderSessionId('wt-1', 'prov-1'),
      manager.saveDisplayName('wt-2', 'Fix the build'),
    ];
    write.finish();
    await Promise.all([first, ...rest]);

    expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    expect(savedManifest).toEqual({
      'wt-1': { ...entry('a'), model: 'opus', providerSessionId: 'prov-1' },
      'wt-2': { ...entry('b'), model: 'sonnet', displayName: 'Fix the build', displayNameSource: 'user' },
    });
  });

  it('a failed write rejects its change, which the next write carries', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': entry('a') }));
    mockFs.writeFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(manager.saveModel('wt-1', 'opus')).rejects.toThrow('disk full');
    expect(await manager.getModel('wt-1')).toBe('opus');

    await manager.saveProviderSessionId('wt-1', 'prov-1');
    expect(savedManifest).toEqual({ 'wt-1': { ...entry('a'), model: 'opus', providerSessionId: 'prov-1' } });
  });

  it('a change waiting behind a failed write is written by the next one', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': entry('a') }));
    const write = holdNextWrite();

    const first = manager.saveModel('wt-1', 'opus');
    await vi.waitFor(() => expect(mockFs.writeFile).toHaveBeenCalledTimes(1));
    const second = manager.saveProviderSessionId('wt-1', 'prov-1');
    write.finish(new Error('disk full'));

    await expect(first).rejects.toThrow('disk full');
    await second;
    expect(savedManifest).toEqual({ 'wt-1': { ...entry('a'), model: 'opus', providerSessionId: 'prov-1' } });
  });

  it('the orphan check doesn\'t hold up other changes while it looks at folders', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': entry('a') }));
    mockGit.mockResolvedValue('');
    let finishAccess!: () => void;
    mockFs.access.mockImplementationOnce(() => new Promise<void>((resolve) => { finishAccess = resolve; }));

    const sweeping = manager.cleanupOrphans('/repo');
    await vi.waitFor(() => expect(mockFs.access).toHaveBeenCalled());
    await manager.saveModel('wt-1', 'opus');
    expect(savedManifest).toEqual({ 'wt-1': { ...entry('a'), model: 'opus' } });

    finishAccess();
    expect(await sweeping).toBe(1); // git doesn't list it
    expect(savedManifest).toEqual({});
  });
});

describe('manifest safety', () => {
  // Built as the manager builds them, so they use the platform's separator.
  const wtPathFor = (repo: string, id: string) =>
    path.join('/mock/userData/worktrees', crypto.createHash('sha256').update(repo).digest('hex').slice(0, 8), id);
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it('refuses to write over a corrupt manifest', async () => {
    mockFs.readFile.mockResolvedValue('{"wt-1": {"repoPath": "/re');

    await expect(manager.saveProviderSessionId('wt-1', 'prov')).rejects.toThrow('corrupt');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('refuses to write when the manifest cannot be read', async () => {
    mockFs.readFile.mockRejectedValue(errno('EBUSY'));

    await expect(manager.saveDisplayName('wt-1', 'x')).rejects.toThrow('Could not read the worktree manifest');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('the sweep deletes nothing when the manifest is corrupt', async () => {
    mockFs.readFile.mockResolvedValue('not json');
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue(['abcd1234']);
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    await expect(manager.sweepStaleWorktrees()).rejects.toThrow('corrupt');
    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('writes the manifest atomically', async () => {
    await manager.registerDirect('/repo', 'main');
    expect(mockFsUtils.writeFileAtomic).toHaveBeenCalledWith(path.join('/mock/userData/worktrees', 'manifest.json'), expect.any(String));
  });

  it('keeps an entry whose directory can\'t be checked, rather than calling it an orphan', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'b', createdAt: 1 } }));
    mockGit.mockResolvedValue('');
    mockFs.access.mockRejectedValue(errno('EPERM'));

    expect(await manager.cleanupOrphans('/repo')).toBe(0);
    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
    expect(await manager.getWorktreeOrManifest('wt-1')).toBeDefined();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('matches git\'s worktree paths without regard to case on Windows', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'b', createdAt: 1 } }));
      mockGit.mockResolvedValue(`worktree ${wtPathFor('/repo', 'wt-1').toUpperCase()}\nbranch refs/heads/b\n`);
      mockFs.access.mockResolvedValue(undefined);

      expect(await manager.cleanupOrphans('/repo')).toBe(0);
      expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
      expect((await manager.list('/repo')).map((w) => w.id)).toEqual(['wt-1']);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('the sweep leaves a worktree that is still being created', async () => {
    const wtPath = wtPathFor('/repo', 'newid001');
    const hashDir = path.dirname(wtPath);
    let finishAdd!: () => void;
    mockGit.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'add') await new Promise<void>((r) => { finishAdd = r; });
      return '';
    });
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockImplementation(async (p: string) => (p === hashDir ? ['newid001'] : [path.basename(hashDir)]));
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });

    const creating = manager.create({ repoPath: '/repo', branchName: 'feat', id: 'newid001' });
    await vi.waitFor(() => expect(finishAdd).toBeDefined());
    await manager.sweepStaleWorktrees();
    finishAdd();
    await creating;

    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
    expect(savedManifest).toHaveProperty('newid001');
  });

  it('a taken branch name fails the create without deleting anything', async () => {
    // Taken after the IPC check passed (two creates racing on one name).
    vi.mocked(branchExists).mockResolvedValue(true);
    mockGit.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'list') return 'worktree /mock/userData/worktrees/x/other\nbranch refs/heads/feat\n';
      if (args[0] === 'worktree' && args[1] === 'add') throw new Error("fatal: a branch named 'feat' already exists");
      return '';
    });

    await expect(manager.create({ repoPath: '/repo', branchName: 'feat', id: 'dup00001' })).rejects.toThrow('already exists');
    const ran = mockGit.mock.calls.map((c) => c[0].join(' '));
    expect(ran.some((c) => c.startsWith('branch -D') || c.startsWith('worktree remove'))).toBe(false);
    expect(savedManifest).not.toHaveProperty('dup00001');
  });
});

describe('worktree trash', () => {
  const root = path.join('/mock/userData/worktrees');
  const trash = path.join(root, '.trash');
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hash = crypto.createHash('sha256').update('/repo').digest('hex').slice(0, 8);
  const DAY = 86_400_000;

  beforeEach(() => {
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.rename.mockResolvedValue(undefined);
    mockGit.mockResolvedValue('');
  });

  it('the sweep moves a folder missing from the manifest to the trash instead of deleting it', async () => {
    mockFs.readdir.mockImplementation(async (p: string) => (p === root ? [hash] : p === path.join(root, hash) ? ['lost0001'] : []));

    await manager.sweepStaleWorktrees();

    expect(mockFs.rename).toHaveBeenCalledWith(
      path.join(root, hash, 'lost0001'), expect.stringMatching(new RegExp(`^${escape(trash + path.sep)}\\d+-${hash}-lost0001$`)),
    );
    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
  });

  it('the sweep leaves the trash itself alone', async () => {
    const recent = `${Date.now() - DAY}-${hash}-old00001`;
    mockFs.readdir.mockImplementation(async (p: string) => (p === root ? ['.trash'] : p === trash ? [recent] : []));

    await manager.sweepStaleWorktrees();

    expect(mockFs.rename).not.toHaveBeenCalled();
    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
  });

  it('purges only folders older than the retention period', async () => {
    const now = Date.now();
    const expired = `${now - 8 * DAY}-${hash}-a0000001`;
    const kept = `${now - 6 * DAY}-${hash}-b0000001`;
    mockFs.readdir.mockResolvedValue([expired, kept, 'not-a-trash-name']);
    mockFsUtils.removeDirectory.mockResolvedValue(undefined);

    expect(await manager.purgeTrash(now)).toBe(1);
    expect(mockFsUtils.removeDirectory).toHaveBeenCalledTimes(1);
    expect(mockFsUtils.removeDirectory).toHaveBeenCalledWith(path.join(trash, expired));
  });

  it('an orphan whose folder git no longer lists goes to the trash', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'b', createdAt: 1 } }));

    expect(await manager.cleanupOrphans('/repo')).toBe(1);
    expect(mockFs.rename).toHaveBeenCalledWith(path.join(root, hash, 'wt-1'), expect.stringContaining(trash + path.sep));
    expect(mockFsUtils.removeDirectory).not.toHaveBeenCalled();
    expect(savedManifest).not.toHaveProperty('wt-1');
  });

  it('keeps the entry of an orphan whose folder is locked, to retry', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ 'wt-1': { repoPath: '/repo', branch: 'b', createdAt: 1 } }));
    mockFs.rename.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    expect(await manager.cleanupOrphans('/repo')).toBe(0);
    expect(await manager.getWorktreeOrManifest('wt-1')).toBeDefined();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});

describe('sweepStaleWorktrees: direct entries', () => {
  it('keeps a folder conversation while its folder exists, and drops git ones whose repo is gone', async () => {
    const { isGitRepo } = await import('./git.js');
    vi.mocked(isGitRepo).mockResolvedValue(false);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockImplementation(async (p: string) => {
      if (p === '/notes') return { isDirectory: () => true };
      throw new Error('ENOENT');
    });
    savedManifest = {
      'wt-folder': { repoPath: '/notes', branch: '', createdAt: 1, direct: true, noGit: true },
      'wt-gone-folder': { repoPath: '/deleted', branch: '', createdAt: 1, direct: true, noGit: true },
      'wt-git-gone': { repoPath: '/old-repo', branch: 'main', createdAt: 1, direct: true },
    };
    mockFs.readFile.mockImplementation(async () => JSON.stringify(savedManifest));

    await manager.sweepStaleWorktrees();

    expect(Object.keys(savedManifest)).toEqual(['wt-folder']);
    vi.mocked(isGitRepo).mockResolvedValue(true);
  });

  it('keeps a git conversation whose folder exists even when git fails at launch', async () => {
    const { isGitRepo } = await import('./git.js');
    vi.mocked(isGitRepo).mockResolvedValue(false);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockImplementation(async (p: string) => {
      if (p === '/repo') return { isDirectory: () => true };
      throw new Error('ENOENT');
    });
    savedManifest = { 'wt-direct': { repoPath: '/repo', branch: 'main', createdAt: 1, direct: true } };
    mockFs.readFile.mockImplementation(async () => JSON.stringify(savedManifest));

    await manager.sweepStaleWorktrees();

    expect(Object.keys(savedManifest)).toEqual(['wt-direct']);
    vi.mocked(isGitRepo).mockResolvedValue(true);
  });
});

describe("Settings > Git's worktree folder", () => {
  const folder = path.resolve('/dev-drive/wt');
  const hash = crypto.createHash('sha256').update('/repo').digest('hex').slice(0, 8);
  const inFolder = (id: string) => path.join(folder, hash, id);
  const errno = (code: string) => Object.assign(new Error(code), { code });
  let setting: string;

  beforeEach(() => {
    setting = '/dev-drive/wt';
    manager = new WorktreeManager(() => setting);
    mockFsUtils.pathExists.mockResolvedValue(true);
    vi.mocked(branchExists).mockResolvedValue(false);
    vi.mocked(branchHasRemote).mockResolvedValue(false);
    mockGit.mockResolvedValue('');
    mockFs.rename.mockResolvedValue(undefined);
  });

  it('makes new worktrees there, and records where, so they are found after the setting changes', async () => {
    const info = await manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' });
    expect(info.path).toBe(inFolder('a1'));
    expect(mockFs.mkdir).toHaveBeenCalledWith(path.join(folder, hash), { recursive: true });
    expect(mockGit).toHaveBeenCalledWith(['worktree', 'add', '-b', 'feat', inFolder('a1')], '/repo');
    expect(savedManifest).toEqual({ a1: expect.objectContaining({ path: inFolder('a1') }) });

    setting = '';
    const restarted = new WorktreeManager(() => setting);
    mockFs.readFile.mockResolvedValue(JSON.stringify(savedManifest));
    mockGit.mockResolvedValue(`worktree ${inFolder('a1')}\nbranch refs/heads/feat\n`);
    expect((await restarted.list('/repo')).map((w) => w.path)).toEqual([inFolder('a1')]);
    expect((await restarted.getWorktreeOrManifest('a1'))?.path).toBe(inFolder('a1'));
  });

  it('keeps making them in the data folder, with no recorded path, when it is empty', async () => {
    setting = '';
    const info = await manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' });
    expect(info.path).toBe(path.join('/mock/userData/worktrees', hash, 'a1'));
    expect(savedManifest.a1).not.toHaveProperty('path');
  });

  it("refuses a folder that isn't a full path, before touching git", async () => {
    setting = 'worktrees';
    await expect(manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' })).rejects.toThrow(
      "Can't make the worktree in worktrees: Use a full path, such as D:\\worktrees. Change the worktree folder in Settings > Git.",
    );
    expect(mockGit).not.toHaveBeenCalled();
    expect(savedManifest).toEqual({});
  });

  it("names the folder it couldn't make, such as one on a drive that isn't there", async () => {
    mockFs.mkdir.mockRejectedValueOnce(errno('ENOENT'));
    await expect(manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' })).rejects.toThrow(
      `Couldn't make the worktree folder ${path.join(folder, hash)}: ENOENT. Change the worktree folder in Settings > Git.`,
    );
    expect(mockGit).not.toHaveBeenCalled();
  });

  it("keeps a worktree whose folder isn't there (a drive not connected yet), and doesn't prune its record", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      a1: { repoPath: '/repo', branch: 'feat', createdAt: 1, path: inFolder('a1') },
      gone: { repoPath: '/repo', branch: 'old', createdAt: 1 },
    }));
    mockFs.access.mockRejectedValue(errno('ENOENT'));
    mockFsUtils.pathExists.mockResolvedValue(false);

    expect(await manager.cleanupOrphans('/repo')).toBe(1);
    expect(Object.keys(savedManifest)).toEqual(['a1']);
    expect(mockGit).not.toHaveBeenCalledWith(['worktree', 'prune'], '/repo');
  });

  it('prunes as before once the folder is back', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      a1: { repoPath: '/repo', branch: 'feat', createdAt: 1, path: inFolder('a1') },
      gone: { repoPath: '/repo', branch: 'old', createdAt: 1 },
    }));
    mockFs.access.mockImplementation(async (p: string) => {
      if (p !== inFolder('a1')) throw errno('ENOENT');
    });
    mockGit.mockResolvedValue(`worktree ${inFolder('a1')}\nbranch refs/heads/feat\n`);

    expect(await manager.cleanupOrphans('/repo')).toBe(1);
    expect(mockGit).toHaveBeenCalledWith(['worktree', 'prune'], '/repo');
  });

  it("the sweep only looks in known projects' folders there, and trashes on that drive", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ a1: { repoPath: '/repo', branch: 'feat', createdAt: 1, path: inFolder('a1') } }));
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockGit.mockResolvedValue(`worktree ${inFolder('a1')}\nbranch refs/heads/feat\n`);
    mockFs.readdir.mockImplementation(async (p: string) => {
      // The user's own folder next to Grove's.
      if (p === folder) return ['my-project', hash];
      if (p === path.join(folder, 'my-project')) return ['src'];
      if (p === path.join(folder, hash)) return ['a1', 'lost0001'];
      return [];
    });

    await manager.sweepStaleWorktrees();

    expect(mockFs.readdir).not.toHaveBeenCalledWith(folder);
    expect(mockFs.readdir).not.toHaveBeenCalledWith(path.join(folder, 'my-project'));
    expect(mockFs.rename).toHaveBeenCalledOnce();
    expect(mockFs.rename).toHaveBeenCalledWith(inFolder('lost0001'), expect.stringContaining(path.join(folder, '.trash') + path.sep));
  });

  it("purges that folder's trash too", async () => {
    const now = Date.now();
    const expired = `${now - 8 * 86_400_000}-${hash}-a0000001`;
    mockFs.readdir.mockImplementation(async (p: string) => (p === path.join(folder, '.trash') ? [expired] : []));
    mockFsUtils.removeDirectory.mockResolvedValue(undefined);

    expect(await manager.purgeTrash(now)).toBe(1);
    expect(mockFsUtils.removeDirectory).toHaveBeenCalledWith(path.join(folder, '.trash', expired));
  });
});

describe('the npm cache each project had', () => {
  it("the sweep deletes it: installs use the user's own cache now", async () => {
    const root = '/mock/userData/worktrees';
    const hash = crypto.createHash('sha256').update('/repo').digest('hex').slice(0, 8);
    mockFs.access.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readdir.mockImplementation(async (p: string) => (p === root ? [hash] : p === path.join(root, hash) ? ['config.json', '.npm-cache'] : []));
    mockFsUtils.removeDirectory.mockResolvedValue(undefined);

    await manager.sweepStaleWorktrees();

    expect(mockFsUtils.removeDirectory).toHaveBeenCalledWith(path.join(root, hash, '.npm-cache'));
    expect(mockFs.rename).not.toHaveBeenCalled();
  });
});

describe("Settings > Git's worktree folder: what is refused or left alone", () => {
  const hash = crypto.createHash('sha256').update('/repo').digest('hex').slice(0, 8);

  beforeEach(() => {
    vi.mocked(branchExists).mockResolvedValue(false);
    vi.mocked(branchHasRemote).mockResolvedValue(false);
    mockGit.mockResolvedValue('');
  });

  it("refuses a folder inside the app's data folder, whose scan would trash its project folders", async () => {
    manager = new WorktreeManager(() => '/mock/userData/worktrees/mine');
    await expect(manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' })).rejects.toThrow("it is inside the app's data folder");
    expect(mockGit).not.toHaveBeenCalled();
  });

  it('takes the data folder itself, as if the setting were empty', async () => {
    manager = new WorktreeManager(() => '/mock/userData/worktrees');
    const info = await manager.create({ repoPath: '/repo', branchName: 'feat', id: 'a1' });
    expect(info.path).toBe(path.join('/mock/userData/worktrees', hash, 'a1'));
    expect(savedManifest.a1).not.toHaveProperty('path');
  });

  it("purges only names the trash gave from that folder's .trash, which may not be Grove's", async () => {
    const folder = path.resolve('/dev-drive');
    manager = new WorktreeManager(() => folder);
    const old = Date.now() - 8 * 86_400_000;
    const names = [`${old}-${hash}-a0000001`, `${old}-holiday-photos`, `${old}`];
    mockFs.readdir.mockImplementation(async (p: string) => (p === path.join(folder, '.trash') ? names : []));
    mockFsUtils.removeDirectory.mockResolvedValue(undefined);

    expect(await manager.purgeTrash()).toBe(1);
    expect(mockFsUtils.removeDirectory).toHaveBeenCalledWith(path.join(folder, '.trash', names[0]));
  });
});
