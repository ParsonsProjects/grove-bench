import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  gitVersion: vi.fn(),
}));

// Mock the adapter registry — checkAllPrerequisites delegates to it
const mockCheckPrerequisites = vi.fn();
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    getDefault: () => ({
      checkPrerequisites: mockCheckPrerequisites,
    }),
  },
}));

import { checkGit, checkAllPrerequisites } from './prerequisites.js';
import { gitVersion } from './git.js';

const mockGitVersion = vi.mocked(gitVersion);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkGit()', () => {
  it('returns available with version when git found', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    const result = await checkGit();
    expect(result.available).toBe(true);
    expect(result.version).toBe('git version 2.39.1');
    expect(result.meetsMinimum).toBe(true);
  });

  it('meets minimum for git 2.17', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.17.0', major: 2, minor: 17, patch: 0 });
    const result = await checkGit();
    expect(result.meetsMinimum).toBe(true);
  });

  it('does not meet minimum for git 2.16', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.16.5', major: 2, minor: 16, patch: 5 });
    const result = await checkGit();
    expect(result.meetsMinimum).toBe(false);
  });

  it('meets minimum for git 3.x', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 3.0.0', major: 3, minor: 0, patch: 0 });
    const result = await checkGit();
    expect(result.meetsMinimum).toBe(true);
  });

  it('does not meet minimum for git 1.x', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 1.9.0', major: 1, minor: 9, patch: 0 });
    const result = await checkGit();
    expect(result.meetsMinimum).toBe(false);
  });

  it('returns unavailable when git not found', async () => {
    mockGitVersion.mockResolvedValue(null);
    const result = await checkGit();
    expect(result.available).toBe(false);
    expect(result.version).toBeUndefined();
    expect(result.meetsMinimum).toBeUndefined();
  });
});

describe('checkAllPrerequisites()', () => {
  it('returns combined results when agent is available', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({
      available: true,
      path: '/usr/local/bin/claude',
      authenticated: true,
      authMethod: 'api_key',
      email: 'user@example.com',
    });

    const result = await checkAllPrerequisites();
    expect(result.git.available).toBe(true);
    expect(result.agent.available).toBe(true);
    expect(result.agent.authenticated).toBe(true);
    expect(result.agent.email).toBe('user@example.com');
  });

  it('returns combined results when agent is not available', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: false });

    const result = await checkAllPrerequisites();
    expect(result.git.available).toBe(true);
    expect(result.agent.available).toBe(false);
  });
});
