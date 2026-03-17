import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  gitVersion: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: any) => fn),
}));

import { checkGit, findClaudeCode, checkAllPrerequisites } from './prerequisites.js';
import { gitVersion } from './git.js';
import { execFile } from 'node:child_process';

const mockGitVersion = vi.mocked(gitVersion);
const mockExecFile = vi.mocked(execFile);

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

describe('findClaudeCode()', () => {
  it('returns unavailable when claude not found', async () => {
    mockExecFile.mockRejectedValue(new Error('not found'));
    const result = await findClaudeCode();
    expect(result.available).toBe(false);
  });

  it('returns available with path when claude found', async () => {
    // First call: `which claude` succeeds
    mockExecFile.mockResolvedValueOnce({ stdout: '/usr/local/bin/claude\n', stderr: '' });
    // Second call: `claude auth status --json` fails (not authenticated)
    mockExecFile.mockRejectedValueOnce(new Error('not authenticated'));

    const result = await findClaudeCode();
    expect(result.available).toBe(true);
    expect(result.path).toBe('/usr/local/bin/claude');
    expect(result.authenticated).toBe(false);
  });

  it('returns authenticated when auth status succeeds', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '/usr/local/bin/claude\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key', email: 'user@example.com' }),
      stderr: '',
    });

    const result = await findClaudeCode();
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.authMethod).toBe('api_key');
    expect(result.email).toBe('user@example.com');
  });

  it('returns not authenticated when loggedIn is false', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: 'C:\\Program Files\\claude.exe\n', stderr: '' });
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({ loggedIn: false }),
      stderr: '',
    });

    const result = await findClaudeCode();
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
  });
});

describe('checkAllPrerequisites()', () => {
  it('returns combined results', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockExecFile.mockRejectedValue(new Error('not found')); // claude not found

    const result = await checkAllPrerequisites();
    expect(result.git.available).toBe(true);
    expect(result.claudeCode.available).toBe(false);
  });
});
