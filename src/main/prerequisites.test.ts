import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  gitVersion: vi.fn(),
}));

vi.mock('./gh.js', () => ({
  ghVersion: vi.fn(),
  ghAuthenticated: vi.fn(),
}));

vi.mock('./credentials.js', () => ({
  hasApiKey: vi.fn(() => false),
  canStoreApiKey: vi.fn(() => true),
}));

// Mock the adapter registry — checkAllPrerequisites delegates to it
const mockCheckPrerequisites = vi.fn();
const mockAdapter: Record<string, unknown> = { checkPrerequisites: mockCheckPrerequisites };
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    getDefault: () => mockAdapter,
  },
}));

import { checkGit, checkGh, checkAllPrerequisites, checkCorePrerequisites } from './prerequisites.js';
import { agentReady, gitReady } from '../shared/prerequisites.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';
import { canStoreApiKey, hasApiKey } from './credentials.js';

const mockGitVersion = vi.mocked(gitVersion);
const mockGhVersion = vi.mocked(ghVersion);
const mockGhAuthenticated = vi.mocked(ghAuthenticated);

beforeEach(() => {
  vi.clearAllMocks();
  delete mockAdapter.apiKey;
  delete mockAdapter.id;
  vi.mocked(hasApiKey).mockReturnValue(false);
  vi.mocked(canStoreApiKey).mockReturnValue(true);
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

describe('checkCorePrerequisites()', () => {
  it('checks git and the agent but never spawns gh', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true, path: '/bin/claude' });

    const result = await checkCorePrerequisites();

    expect(result.git.available).toBe(true);
    expect(result.agent.authenticated).toBe(true);
    expect(result.gh).toBeUndefined();
    expect(mockGhVersion).not.toHaveBeenCalled();
    expect(mockGhAuthenticated).not.toHaveBeenCalled();
  });

  it('surfaces the adapter auth message when not authenticated', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: false });

    const result = await checkCorePrerequisites();
    expect(result.agent.authenticated).toBe(false);
    expect(result.agent.errorMessage).toBeUndefined();
  });
});

describe('API key state', () => {
  beforeEach(() => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: false });
  });

  it('is omitted when the adapter takes no API key', async () => {
    const result = await checkCorePrerequisites();
    expect(result.agent.apiKey).toBeUndefined();
  });

  it('describes the key field without the key itself', async () => {
    mockAdapter.id = 'claude-code';
    mockAdapter.apiKey = { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys' };
    vi.mocked(hasApiKey).mockReturnValue(true);

    const result = await checkCorePrerequisites();

    expect(hasApiKey).toHaveBeenCalledWith('claude-code');
    expect(result.agent.apiKey).toEqual({
      label: 'Anthropic API key',
      helpUrl: 'https://example.com/keys',
      saved: true,
      canStore: true,
    });
    expect(JSON.stringify(result)).not.toContain('ANTHROPIC_API_KEY');
  });

  it('reports when the OS cannot store a key', async () => {
    mockAdapter.id = 'claude-code';
    mockAdapter.apiKey = { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys' };
    vi.mocked(canStoreApiKey).mockReturnValue(false);

    const result = await checkCorePrerequisites();
    expect(result.agent.apiKey?.canStore).toBe(false);
  });
});

describe('gitReady()', () => {
  const agent = { available: true, authenticated: true };

  it('passes with git 2.17+ and ignores the agent', () => {
    expect(gitReady({ git: { available: true, meetsMinimum: true }, agent })).toBe(true);
    expect(gitReady({ git: { available: true, meetsMinimum: true }, agent: { available: false } })).toBe(true);
  });

  it('fails when git is missing or too old', () => {
    expect(gitReady({ git: { available: false }, agent })).toBe(false);
    expect(gitReady({ git: { available: true, meetsMinimum: false }, agent })).toBe(false);
  });
});

describe('agentReady()', () => {
  const git = { available: false };
  const key = (saved: boolean) => ({ label: 'API key', helpUrl: 'https://example.com', saved, canStore: true });

  it('passes with a CLI sign-in or env credentials, even without git', () => {
    expect(agentReady({ git, agent: { available: true, authenticated: true } })).toBe(true);
    expect(agentReady({ git, agent: { available: false, authenticated: true, authMethod: 'ANTHROPIC_API_KEY' } })).toBe(true);
  });

  it('passes with a saved API key when the CLI is missing or signed out', () => {
    expect(agentReady({ git, agent: { available: false, apiKey: key(true) } })).toBe(true);
    expect(agentReady({ git, agent: { available: true, authenticated: false, apiKey: key(true) } })).toBe(true);
  });

  it('fails with no credentials at all', () => {
    expect(agentReady({ git, agent: { available: true, authenticated: false, apiKey: key(false) } })).toBe(false);
    expect(agentReady({ git, agent: { available: true } })).toBe(false);
    expect(agentReady({ git, agent: { available: false } })).toBe(false);
  });
});
