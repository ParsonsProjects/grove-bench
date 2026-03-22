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

import { WorktreeManager } from './worktree-manager.js';

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
