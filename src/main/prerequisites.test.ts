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
  isApiKeyRejected: vi.fn(() => false),
  isApiKeyUnverified: vi.fn(() => false),
}));

// Mock the adapter registry: the checks run every registered adapter.
const mockCheckPrerequisites = vi.fn();
function makeAdapter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'claude-code', displayName: 'Claude Agent', authErrorMessage: 'Sign in.', checkPrerequisites: mockCheckPrerequisites, ...overrides };
}
let mockAdapters: Array<Record<string, unknown>> = [];
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: {
    list: () => mockAdapters,
  },
}));

import { checkGit, checkGh, checkAllPrerequisites, checkCorePrerequisites } from './prerequisites.js';
import { agentReady, gitReady } from '../shared/prerequisites.js';
import { gitVersion } from './git.js';
import { ghVersion, ghAuthenticated } from './gh.js';
import { canStoreApiKey, hasApiKey, isApiKeyRejected, isApiKeyUnverified } from './credentials.js';

const mockGitVersion = vi.mocked(gitVersion);
const mockGhVersion = vi.mocked(ghVersion);
const mockGhAuthenticated = vi.mocked(ghAuthenticated);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapters = [makeAdapter()];
  vi.mocked(hasApiKey).mockReturnValue(false);
  vi.mocked(canStoreApiKey).mockReturnValue(true);
  vi.mocked(isApiKeyRejected).mockReturnValue(false);
  vi.mocked(isApiKeyUnverified).mockReturnValue(false);
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
    expect(result.agents['claude-code'].available).toBe(true);
    expect(result.agents['claude-code'].authenticated).toBe(true);
    expect(result.agents['claude-code'].email).toBe('user@example.com');
  });

  it('returns combined results when agent is not available', async () => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: false });

    const result = await checkAllPrerequisites();
    expect(result.git.available).toBe(true);
    expect(result.agents['claude-code'].available).toBe(false);
  });
});

describe('checkCorePrerequisites()', () => {
  beforeEach(() => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
  });

  it('checks git and the agent but never spawns gh', async () => {
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true, path: '/bin/claude' });

    const result = await checkCorePrerequisites();

    expect(result.git.available).toBe(true);
    expect(result.agents['claude-code'].authenticated).toBe(true);
    expect(result.gh).toBeUndefined();
    expect(mockGhVersion).not.toHaveBeenCalled();
    expect(mockGhAuthenticated).not.toHaveBeenCalled();
  });

  it('surfaces the adapter auth message when not authenticated', async () => {
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: false });

    const result = await checkCorePrerequisites();
    expect(result.agents['claude-code']).toMatchObject({ authenticated: false, authErrorMessage: 'Sign in.' });
    expect(result.agents['claude-code'].errorMessage).toBeUndefined();
  });

  it('checks every registered agent, keyed by adapter id', async () => {
    const otherCheck = vi.fn().mockResolvedValue({ available: true, authenticated: false });
    mockAdapters = [makeAdapter(), makeAdapter({ id: 'codex', displayName: 'Codex', checkPrerequisites: otherCheck })];
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true });

    const result = await checkCorePrerequisites();

    expect(Object.keys(result.agents)).toEqual(['claude-code', 'codex']);
    expect(result.agents['claude-code'].authenticated).toBe(true);
    expect(result.agents.codex.authenticated).toBe(false);
    expect(otherCheck).toHaveBeenCalledTimes(1);
  });

  it("keeps the other agents when one agent's check throws", async () => {
    const broken = vi.fn().mockRejectedValue(new Error('boom'));
    mockAdapters = [makeAdapter(), makeAdapter({ id: 'codex', displayName: 'Codex', checkPrerequisites: broken })];
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: true });

    const result = await checkCorePrerequisites();

    expect(result.agents['claude-code'].authenticated).toBe(true);
    expect(result.agents.codex).toMatchObject({ available: false, errorMessage: 'Codex check failed: boom' });
  });
});

describe('API key state', () => {
  beforeEach(() => {
    mockGitVersion.mockResolvedValue({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
    mockCheckPrerequisites.mockResolvedValue({ available: true, authenticated: false });
  });

  it('is omitted when the adapter takes no API key', async () => {
    const result = await checkCorePrerequisites();
    expect(result.agents['claude-code'].apiKey).toBeUndefined();
  });

  it('describes the key field without the key itself', async () => {
    mockAdapters = [makeAdapter({ apiKey: { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys' } })];
    vi.mocked(hasApiKey).mockReturnValue(true);

    const result = await checkCorePrerequisites();

    expect(hasApiKey).toHaveBeenCalledWith('claude-code');
    expect(result.agents['claude-code'].apiKey).toEqual({
      label: 'Anthropic API key',
      helpUrl: 'https://example.com/keys',
      saved: true,
      canStore: true,
    });
    expect(JSON.stringify(result)).not.toContain('ANTHROPIC_API_KEY');
  });

  it('says when the saved key was refused or saved unchecked', async () => {
    mockAdapters = [makeAdapter({ apiKey: { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys' } })];
    vi.mocked(hasApiKey).mockReturnValue(true);
    vi.mocked(isApiKeyRejected).mockReturnValue(true);
    expect((await checkCorePrerequisites()).agents['claude-code'].apiKey).toMatchObject({ saved: true, rejected: true });

    vi.mocked(isApiKeyRejected).mockReturnValue(false);
    vi.mocked(isApiKeyUnverified).mockReturnValue(true);
    const unverified = (await checkCorePrerequisites()).agents['claude-code'].apiKey;
    expect(unverified).toMatchObject({ saved: true, unverified: true });
    expect(unverified).not.toHaveProperty('rejected');
  });

  it('reports when the OS cannot store a key', async () => {
    mockAdapters = [makeAdapter({ apiKey: { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys' } })];
    vi.mocked(canStoreApiKey).mockReturnValue(false);

    const result = await checkCorePrerequisites();
    expect(result.agents['claude-code'].apiKey?.canStore).toBe(false);
  });

  it('passes on how a key is billed and how to sign in with the CLI instead', async () => {
    const cliSignIn = { accountLabel: 'Claude plan', cliName: 'Claude Code', command: 'claude', setupUrl: 'https://example.com/setup' };
    mockAdapters = [makeAdapter({
      apiKey: { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', helpUrl: 'https://example.com/keys', billingNote: 'Billed separately.' },
      cliSignIn,
    })];

    const result = await checkCorePrerequisites();
    expect(result.agents['claude-code'].apiKey?.billingNote).toBe('Billed separately.');
    expect(result.agents['claude-code'].cliSignIn).toEqual(cliSignIn);
  });
});

describe('gitReady()', () => {
  const agents = { 'claude-code': { available: true, authenticated: true } };

  it('passes with git 2.17+ and ignores the agents', () => {
    expect(gitReady({ git: { available: true, meetsMinimum: true }, agents })).toBe(true);
    expect(gitReady({ git: { available: true, meetsMinimum: true }, agents: {} })).toBe(true);
  });

  it('fails when git is missing or too old', () => {
    expect(gitReady({ git: { available: false }, agents })).toBe(false);
    expect(gitReady({ git: { available: true, meetsMinimum: false }, agents })).toBe(false);
  });
});

describe('agentReady()', () => {
  const git = { available: false };
  const key = (saved: boolean) => ({ label: 'API key', helpUrl: 'https://example.com', saved, canStore: true });
  const ready = (agent: Record<string, unknown>) => agentReady({ git, agents: { a: agent as never } }, 'a');

  it('passes with a CLI sign-in or env credentials, even without git', () => {
    expect(ready({ available: true, authenticated: true })).toBe(true);
    expect(ready({ available: false, authenticated: true, authMethod: 'ANTHROPIC_API_KEY' })).toBe(true);
  });

  it('passes with a saved API key when the CLI is missing or signed out', () => {
    expect(ready({ available: false, apiKey: key(true) })).toBe(true);
    expect(ready({ available: true, authenticated: false, apiKey: key(true) })).toBe(true);
  });

  it('fails while the saved key is refused, even with a CLI sign-in (the key is used first)', () => {
    const refused = { ...key(true), rejected: true };
    expect(ready({ available: true, authenticated: false, apiKey: refused })).toBe(false);
    expect(ready({ available: true, authenticated: true, apiKey: refused })).toBe(false);
  });

  it('fails with no credentials at all', () => {
    expect(ready({ available: true, authenticated: false, apiKey: key(false) })).toBe(false);
    expect(ready({ available: true })).toBe(false);
    expect(ready({ available: false })).toBe(false);
  });

  it('only looks at the agent asked about', () => {
    const status = { git, agents: { a: { available: true, authenticated: true }, b: { available: true, authenticated: false } } };
    expect(agentReady(status, 'a')).toBe(true);
    expect(agentReady(status, 'b')).toBe(false);
    expect(agentReady(status, 'missing')).toBe(false);
  });
});
