import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  gitVersion: vi.fn(),
}));

vi.mock('./gh.js', () => ({
  ghVersion: vi.fn(),
  ghAuthenticated: vi.fn(),
}));

// Mock the adapter registry — checkAllPrerequisites iterates every registered
// adapter. Tests mutate mockAdapters to simulate one or many providers.
const mockCheckPrerequisites = vi.fn();
const mockAdapters: Array<{
  id: string;
  displayName: string;
  authErrorMessage: string;
  checkPrerequisites: ReturnType<typeof vi.fn>;
}> = [];
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    list: () => mockAdapters,
    getDefault: () => mockAdapters[0],
  },
}));

import { checkGit, checkGh, checkAllPrerequisites } from './prerequisites.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';

const mockGitVersion = vi.mocked(gitVersion);
const mockGhVersion = vi.mocked(ghVersion);
const mockGhAuthenticated = vi.mocked(ghAuthenticated);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapters.length = 0;
  mockAdapters.push({
    id: 'claude-code',
    displayName: 'Claude Code',
    authErrorMessage: 'Run "claude auth login".',
    checkPrerequisites: mockCheckPrerequisites,
  });
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

describe('checkGh()', () => {
  it('returns available with version and auth state when gh found', async () => {
    mockGhVersion.mockResolvedValue('2.40.0');
    mockGhAuthenticated.mockResolvedValue(true);
    const result = await checkGh();
    expect(result).toEqual({ available: true, version: '2.40.0', authenticated: true });
  });

  it('reports unauthenticated gh', async () => {
    mockGhVersion.mockResolvedValue('2.40.0');
    mockGhAuthenticated.mockResolvedValue(false);
    const result = await checkGh();
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
  });

  it('returns unavailable when gh not found', async () => {
    mockGhVersion.mockResolvedValue(null);
    const result = await checkGh();
    expect(result).toEqual({ available: false });
    expect(mockGhAuthenticated).not.toHaveBeenCalled();
  });
});

describe('checkAllPrerequisites()', () => {
  beforeEach(() => {
    mockGhVersion.mockResolvedValue(null);
  });

  it('includes gh status without gating on it', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true });
    mockGhVersion.mockResolvedValue('2.40.0');
    mockGhAuthenticated.mockResolvedValue(true);

    const result = await checkAllPrerequisites();
    expect(result.gh).toEqual({ available: true, version: '2.40.0', authenticated: true });
  });

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
    const agent = result.agents['claude-code'];
    expect(agent.available).toBe(true);
    expect(agent.authenticated).toBe(true);
    expect(agent.email).toBe('user@example.com');
    expect(agent.displayName).toBe('Claude Code');
    expect(agent.isDefault).toBe(true);
  });

  it('returns combined results when agent is not available', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: false });

    const result = await checkAllPrerequisites();
    expect(result.git.available).toBe(true);
    expect(result.agents['claude-code'].available).toBe(false);
  });

  it('sets authErrorMessage from the adapter when available but unauthenticated', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: false });

    const result = await checkAllPrerequisites();
    expect(result.agents['claude-code'].authErrorMessage).toBe('Run "claude auth login".');
  });

  it('reports every registered adapter independently', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true });
    mockAdapters.push({
      id: 'mistral-vibe',
      displayName: 'Mistral Vibe',
      authErrorMessage: 'Set your Mistral API key.',
      checkPrerequisites: vi.fn().mockResolvedValue({
        available: false,
        installInstructions: 'Install with: uv tool install mistral-vibe',
      }),
    });

    const result = await checkAllPrerequisites();
    expect(Object.keys(result.agents)).toEqual(['claude-code', 'mistral-vibe']);
    expect(result.agents['claude-code'].available).toBe(true);
    expect(result.agents['claude-code'].isDefault).toBe(true);
    const mistral = result.agents['mistral-vibe'];
    expect(mistral.available).toBe(false);
    expect(mistral.isDefault).toBe(false);
    expect(mistral.errorMessage).toBe('Agent not found. Install with: uv tool install mistral-vibe');
  });

  it('treats a throwing adapter check as unavailable instead of failing the whole call', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true });
    mockAdapters.push({
      id: 'broken',
      displayName: 'Broken',
      authErrorMessage: '',
      checkPrerequisites: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await checkAllPrerequisites();
    expect(result.agents['claude-code'].available).toBe(true);
    expect(result.agents['broken'].available).toBe(false);
    expect(result.agents['broken'].errorMessage).toBe('boom');
  });
});
