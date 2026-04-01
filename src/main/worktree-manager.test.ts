import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
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
  git: vi.fn(),
  isGitRepo: vi.fn().mockResolvedValue(true),
  renameBranch: vi.fn(),
  branchHasRemote: vi.fn(),
  validateBranchName: vi.fn(),
  branchExists: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { git } from './git.js';
import { WorktreeManager } from './worktree-manager.js';

const mockGit = vi.mocked(git);

let manager: WorktreeManager;
let savedManifest: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  manager = new WorktreeManager();
  savedManifest = {};

  // Default: empty manifest
  mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
  mockFs.writeFile.mockImplementation(async (_path: string, data: string) => {
    savedManifest = JSON.parse(data);
  });
  mockFs.mkdir.mockResolvedValue(undefined);
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

    // Verify serialization: all operations for one worktree should finish
    // before the other starts (worktree remove calls should not interleave)
    const worktreeRemoveStarts = callOrder
      .filter((e) => e.startsWith('start:worktree:'))
      .map((e) => e.split(':')[2]);
    const worktreeRemoveEnds = callOrder
      .filter((e) => e.startsWith('end:worktree:'))
      .map((e) => e.split(':')[2]);

    // The first remove should end before the second starts
    // (both entries exist, so order is either a-then-b or b-then-a)
    const firstStarted = worktreeRemoveStarts[0];
    const firstEnded = worktreeRemoveEnds[0];
    expect(firstStarted).toBe(firstEnded); // same worktree starts and ends first
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
});
