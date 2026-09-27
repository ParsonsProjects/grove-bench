import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: vi.fn(),
}));

vi.mock('../credentials.js', () => ({
  getApiKey: vi.fn(() => null),
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { ClaudeCodeAdapter, envAuthMethod } from './claude-code.js';
import { getApiKey } from '../credentials.js';

type ExecResult = { stdout: string } | Error;

/** Answer each execFile call in order: `which claude`, then `claude auth status`. */
function execFileAnswers(...answers: ExecResult[]): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const next = answers.shift() ?? new Error('unexpected execFile call');
    if (next instanceof Error) cb(next);
    else cb(null, { stdout: next.stdout, stderr: '' });
  });
}

const AUTH_ENV = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(AUTH_ENV.map((k) => [k, process.env[k]]));
  for (const k of AUTH_ENV) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('envAuthMethod()', () => {
  it('returns null with no credentials in the environment', () => {
    expect(envAuthMethod({})).toBeNull();
    expect(envAuthMethod({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
  });

  it('recognises an API key', () => {
    expect(envAuthMethod({ ANTHROPIC_API_KEY: 'sk-test' })).toBe('ANTHROPIC_API_KEY');
  });

  it('recognises third-party provider switches', () => {
    expect(envAuthMethod({ CLAUDE_CODE_USE_BEDROCK: '1' })).toBe('Amazon Bedrock');
    expect(envAuthMethod({ CLAUDE_CODE_USE_VERTEX: 'true' })).toBe('Google Vertex AI');
    expect(envAuthMethod({ CLAUDE_CODE_USE_FOUNDRY: '1' })).toBe('Microsoft Foundry');
    expect(envAuthMethod({ CLAUDE_CODE_USE_ANTHROPIC_AWS: '1' })).toBe('Claude Platform on AWS');
  });

  it('ignores switches that are turned off', () => {
    expect(envAuthMethod({ CLAUDE_CODE_USE_BEDROCK: '0' })).toBeNull();
    expect(envAuthMethod({ CLAUDE_CODE_USE_VERTEX: '' })).toBeNull();
  });
});

describe('ClaudeCodeAdapter.checkPrerequisites()', () => {
  const adapter = new ClaudeCodeAdapter();

  it('reports the CLI missing and no credentials', async () => {
    execFileAnswers(new Error('not found'));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: false, authenticated: false });
  });

  it('counts an env API key as signed in even without the CLI', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    execFileAnswers(new Error('not found'));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: false, authenticated: true, authMethod: 'ANTHROPIC_API_KEY' });
  });

  it('skips the CLI auth probe when the environment already has credentials', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    execFileAnswers({ stdout: '/usr/bin/claude\n' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, path: '/usr/bin/claude', authenticated: true, authMethod: 'Amazon Bedrock' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('reads the CLI sign-in', async () => {
    execFileAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: true, authMethod: 'claude.ai', email: 'a@b.c' });
  });

  it('treats a failed or slow auth probe as signed out, not as a crash', async () => {
    execFileAnswers({ stdout: '/usr/bin/claude\n' }, Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: false });
  });

  it('puts a time limit on both CLI calls', async () => {
    execFileAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":false}' });
    await adapter.checkPrerequisites();
    expect(execFileMock).toHaveBeenCalledTimes(2);
    for (const call of execFileMock.mock.calls) {
      expect((call[2] as { timeout?: number }).timeout).toBeGreaterThan(0);
    }
  });
});

describe('ClaudeCodeAdapter saved API key', () => {
  const adapter = new ClaudeCodeAdapter();

  it('offers an Anthropic API key', () => {
    expect(adapter.apiKey).toMatchObject({ envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic API key' });
    expect(adapter.apiKey.helpUrl).toMatch(/^https:\/\//);
  });

  it('passes a saved key to the agent as ANTHROPIC_API_KEY', () => {
    vi.mocked(getApiKey).mockReturnValue('sk-saved');
    expect(adapter['savedKeyEnv']()).toEqual({ ANTHROPIC_API_KEY: 'sk-saved' });
    expect(getApiKey).toHaveBeenCalledWith('claude-code');
  });

  it('adds nothing when no key is saved', () => {
    vi.mocked(getApiKey).mockReturnValue(null);
    expect(adapter['savedKeyEnv']()).toEqual({});
  });
});
