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

import { ClaudeCodeAdapter, CLAUDE_AUTH_ERROR_MESSAGE, envAuthMethod, transformMessage, verifyAnthropicKey } from './claude-code.js';
import { getApiKey } from '../credentials.js';
import { net } from 'electron';

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

describe('verifyAnthropicKey()', () => {
  const answer = (status: number) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });

  it('accepts a key Anthropic accepts, sending it the way the API expects', async () => {
    const fetchFn = answer(200);
    expect(await verifyAnthropicKey('sk-good', { env: {}, fetchFn })).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(init.headers).toEqual({ 'x-api-key': 'sk-good', 'anthropic-version': '2023-06-01' });
  });

  it('refuses a key Anthropic answers 401 to', async () => {
    expect(await verifyAnthropicKey('typo', { env: {}, fetchFn: answer(401) })).toBe(false);
  });

  it("can't tell on other answers or when offline", async () => {
    expect(await verifyAnthropicKey('k', { env: {}, fetchFn: answer(500) })).toBeNull();
    expect(await verifyAnthropicKey('k', { env: {}, fetchFn: answer(403) })).toBeNull();
    expect(await verifyAnthropicKey('k', { env: {}, fetchFn: vi.fn().mockRejectedValue(new Error('offline')) })).toBeNull();
  });

  it('checks nothing when conversations go to a custom endpoint', async () => {
    const fetchFn = answer(401);
    expect(await verifyAnthropicKey('k', { env: { ANTHROPIC_BASE_URL: 'https://gateway.example' }, fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('a refused sign-in mid-conversation', () => {
  it("replaces the CLI's \"Invalid API key\" reply with Grove's own help, flagged as an auth failure", () => {
    const events = transformMessage({
      type: 'assistant',
      error: 'authentication_failed',
      uuid: 'u1',
      message: { content: [{ type: 'text', text: 'Invalid API key · Fix external API key' }] },
    } as any, { toolUseMap: new Map() });
    expect(events).toEqual([{ type: 'error', message: CLAUDE_AUTH_ERROR_MESSAGE, auth: true, keyRejected: true }]);
  });

  it('leaves other API errors as the CLI words them', () => {
    const events = transformMessage({
      type: 'assistant',
      error: 'rate_limit',
      uuid: 'u1',
      message: { content: [{ type: 'text', text: 'Rate limited' }] },
    } as any, { toolUseMap: new Map() });
    expect(events).toEqual([{ type: 'assistant_text', text: 'Rate limited', uuid: 'u1' }]);
  });

  it('points to the Agents settings by their plain name', () => {
    expect(CLAUDE_AUTH_ERROR_MESSAGE).toContain('Settings → Agents');
  });
});

describe('ClaudeCodeAdapter for another Claude account', () => {
  const account = { id: 'claude-account-work', name: 'Work', configDir: '/home/me/.claude-work' };
  const adapter = new ClaudeCodeAdapter(undefined, account);

  // Some tests here give the account a saved key; later tests start without one.
  afterEach(() => { vi.mocked(getApiKey).mockReturnValue(null); });

  it('is its own agent, named after the account', () => {
    expect(adapter.id).toBe('claude-account-work');
    expect(adapter.displayName).toBe('Claude Agent (Work)');
    expect(new ClaudeCodeAdapter().id).toBe('claude-code');
  });

  it("signs in with Claude Code's own command, pointed at the account's folder", () => {
    expect(adapter.cliSignIn.command).toBe("$env:CLAUDE_CONFIG_DIR = '/home/me/.claude-work'; claude auth login; Remove-Item Env:CLAUDE_CONFIG_DIR");
    expect(adapter.authErrorMessage).toContain('Work');
    expect(adapter.authErrorMessage).not.toContain('run "claude"');
  });

  it('reads the sign-in in its folder and ignores credentials in Grove\'s environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-shell';
    execFileAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"me@work.example"}' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: true, email: 'me@work.example' });
    const env = (execFileMock.mock.calls[1][2] as { env: Record<string, string | undefined> }).env;
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-work');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('is signed out without the CLI, even with a key in the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-shell';
    execFileAnswers(new Error('not found'));
    expect(await adapter.checkPrerequisites()).toMatchObject({ available: false, authenticated: false });
  });

  it('runs the agent with the folder and its own saved key, not the shell key', () => {
    vi.mocked(getApiKey).mockReturnValue('sk-work');
    const env = { ...adapter['agentEnv']({ ANTHROPIC_API_KEY: 'sk-shell', PATH: '/bin' }), ...adapter['savedKeyEnv']() };
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/me/.claude-work', ANTHROPIC_API_KEY: 'sk-work' });
    expect(getApiKey).toHaveBeenCalledWith('claude-account-work');
  });

  it("leaves the default account's environment as it is", () => {
    const base = { ANTHROPIC_API_KEY: 'sk-shell', PATH: '/bin' };
    expect(new ClaudeCodeAdapter()['agentEnv'](base)).toBe(base);
    expect(new ClaudeCodeAdapter()['cliEnv']()).toEqual({});
  });

  it("edits the account's own MCP configuration", async () => {
    execFileAnswers({ stdout: '' });
    await adapter.listConfiguredMcpServers('/repo');
    expect((execFileMock.mock.calls[0][2] as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-work');
  });

  it("checks a pasted key with Anthropic even when Grove's environment points elsewhere", async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example';
    try {
      vi.mocked(net.fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
      expect(await adapter.verifyApiKey('sk-work')).toBe(true);
      // The default account sends its requests to that address, so it can't tell.
      expect(await new ClaudeCodeAdapter().verifyApiKey('sk-default')).toBeNull();
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  it("doesn't look for its threads' titles in the default folder", async () => {
    expect(await adapter.getConversationTitle('session-1', '/repo')).toBeNull();
  });
});
