import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The CLI lookup runs in the process host (runProcess) and the claude CLI
// in the agent host (runInAgentHost), never here.
const runMock = vi.hoisted(() => vi.fn());
vi.mock('../process-host.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runProcess: runMock,
}));
const agentRunMock = vi.hoisted(() => vi.fn());
vi.mock('../process-host-run.js', () => ({ runInAgentHost: agentRunMock }));
const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => childProcess);

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

/** Answer each CLI call in order, wherever it runs: `which claude`, then
 *  `claude auth status`. */
function cliAnswers(...answers: ExecResult[]): void {
  const answer = async () => {
    const next = answers.shift() ?? new Error('unexpected CLI call');
    if (next instanceof Error) throw next;
    return { stdout: next.stdout, stderr: '', exitCode: 0, failed: false, timedOut: false };
  };
  runMock.mockImplementation(answer);
  agentRunMock.mockImplementation(answer);
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
    cliAnswers(new Error('not found'));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: false, authenticated: false });
  });

  it('counts an env API key as signed in even without the CLI', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    cliAnswers(new Error('not found'));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: false, authenticated: true, authMethod: 'ANTHROPIC_API_KEY' });
  });

  it('skips the CLI auth probe when the environment already has credentials', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    cliAnswers({ stdout: '/usr/bin/claude\n' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, path: '/usr/bin/claude', authenticated: true, authMethod: 'Amazon Bedrock' });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(agentRunMock).not.toHaveBeenCalled();
  });

  it('reads the CLI sign-in', async () => {
    cliAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: true, authMethod: 'claude.ai', email: 'a@b.c' });
  });

  it('treats a failed or slow auth probe as signed out, not as a crash', async () => {
    cliAnswers({ stdout: '/usr/bin/claude\n' }, Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }));
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: false });
  });

  it('puts a time limit on both CLI calls', async () => {
    cliAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":false}' });
    await adapter.checkPrerequisites();
    const calls = [...runMock.mock.calls, ...agentRunMock.mock.calls];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect((call[2] as { timeout?: number }).timeout).toBeGreaterThan(0);
    }
  });

  it('looks the CLI up in the process host and asks it for the sign-in in the agent host, both safe to run again', async () => {
    cliAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":true}' });
    await adapter.checkPrerequisites();
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    // The lookup needs no shell; `auth status` runs as the CLI always has,
    // its command line in a shell.
    expect(runMock.mock.calls).toEqual([[lookup, ['claude'], { timeout: 10_000, idempotent: true }]]);
    expect(agentRunMock.mock.calls).toEqual([
      ['/usr/bin/claude', ['auth', 'status', '--json'], { timeout: 15_000, idempotent: true, shell: true }],
    ]);
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

describe('ClaudeCodeAdapter MCP and plugin commands', () => {
  const adapter = new ClaudeCodeAdapter();
  const ran = () => agentRunMock.mock.calls.map(([file, args, opts]) => [file, args, opts]);

  beforeEach(() => {
    agentRunMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false });
  });

  afterEach(() => {
    // Nothing here starts a process in the main process, or in the process host.
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('lists MCP servers through the CLI in the agent host, in a shell, safe to run again', async () => {
    agentRunMock.mockResolvedValueOnce({ stdout: 'figma: https://mcp.figma.com/mcp (HTTP) - ✔ Connected\n', stderr: '', exitCode: 0, failed: false, timedOut: false });
    expect(await adapter.listConfiguredMcpServers('/repo')).toEqual([expect.objectContaining({ name: 'figma' })]);
    expect(ran()).toEqual([['claude', ['mcp', 'list'], { shell: true, cwd: '/repo', timeout: 60_000, idempotent: true }]]);
  });

  it('adds and removes MCP servers through the CLI in the agent host, args quoted for the shell', async () => {
    await adapter.addConfiguredMcpServer({ name: 'my-server', transport: 'stdio', scope: 'user', commandOrUrl: 'npx', args: ['some mcp'], cwd: '/repo' });
    await adapter.removeConfiguredMcpServer('my-server', 'user', '/repo');
    expect(ran()).toEqual([
      ['claude', ['mcp', 'add', '-s', 'user', '-t', 'stdio', 'my-server', '--', 'npx', '"some mcp"'], { shell: true, cwd: '/repo', timeout: 30_000 }],
      ['claude', ['mcp', 'remove', '-s', 'user', 'my-server'], { shell: true, cwd: '/repo', timeout: 30_000 }],
    ]);
  });

  it('lists, installs, uninstalls, enables and disables plugins through the CLI in the agent host', async () => {
    agentRunMock.mockResolvedValueOnce({ stdout: '{"installed":[{"id":"p@m"}],"available":[]}', stderr: '', exitCode: 0, failed: false, timedOut: false });
    expect(await adapter.listPlugins()).toEqual({ installed: [{ id: 'p@m' }], available: [] });
    await adapter.installPlugin('p@m', 'project');
    await adapter.uninstallPlugin('p@m');
    await adapter.enablePlugin('p@m');
    await adapter.disablePlugin('p@m');
    expect(ran()).toEqual([
      // Only listing is safe to run again.
      ['claude', ['plugin', 'list', '--json', '--available'], { shell: true, idempotent: true }],
      ['claude', ['plugin', 'install', 'p@m', '--scope', 'project'], { shell: true }],
      ['claude', ['plugin', 'uninstall', 'p@m'], { shell: true }],
      ['claude', ['plugin', 'enable', 'p@m'], { shell: true }],
      ['claude', ['plugin', 'disable', 'p@m'], { shell: true }],
    ]);
  });

  it('passes a failed CLI command on, and lists no plugins when listing fails', async () => {
    agentRunMock.mockRejectedValue(Object.assign(new Error('Command failed with exit code 1: claude plugin install x'), { exitCode: 1, stderr: 'not found' }));
    await expect(adapter.installPlugin('x')).rejects.toMatchObject({ exitCode: 1, stderr: 'not found' });
    expect(await adapter.listPlugins()).toEqual({ installed: [], available: [] });
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
    cliAnswers({ stdout: '/usr/bin/claude\n' }, { stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"me@work.example"}' });
    const status = await adapter.checkPrerequisites();
    expect(status).toMatchObject({ available: true, authenticated: true, email: 'me@work.example' });
    const opts = agentRunMock.mock.calls[0][2] as { env: Record<string, string | undefined>; extendEnv?: boolean };
    expect(opts.env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-work');
    expect(opts.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    // The whole environment: the key left out mustn't come back from the
    // one the command would otherwise inherit.
    expect(opts.extendEnv).toBe(false);
  });

  it('is signed out without the CLI, even with a key in the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-shell';
    cliAnswers(new Error('not found'));
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
    cliAnswers({ stdout: '' });
    await adapter.listConfiguredMcpServers('/repo');
    expect((agentRunMock.mock.calls[0][2] as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-work');
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
