import { describe, it, expect, vi } from 'vitest';
import { openCodeEnv, verifyOpenRouterKey, OPENCODE_DEFAULT_MODEL } from './opencode.js';
import { ACP_PRESETS } from './presets.js';
import { AcpAdapter } from './acp-adapter.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const config = (env: Record<string, string>) => JSON.parse(env.OPENCODE_CONFIG_CONTENT);

describe('the OpenCode preset', () => {
  it('is built in as an alpha agent, unlike Gemini CLI and Copilot CLI', () => {
    const stages = Object.fromEntries(ACP_PRESETS.map((p) => [p.id, p.stage ?? null]));
    expect(stages).toEqual({ 'gemini-cli': null, 'copilot-cli': null, opencode: 'alpha' });
    expect(new AcpAdapter(ACP_PRESETS.find((p) => p.id === 'opencode')!).stage).toBe('alpha');
  });
});

describe('openCodeEnv', () => {
  it('makes edits, commands and fetches ask, turns off subagents, and takes edits away from plan mode', () => {
    const c = config(openCodeEnv({}, { savedKey: false }));
    const asking = { edit: 'ask', bash: 'ask', webfetch: 'ask', task: 'deny' };
    expect(c.permission).toEqual(asking);
    expect(c.agent.build.permission).toEqual(asking);
    expect(c.agent.plan.permission).toEqual({ ...asking, edit: 'deny' });
  });

  it('puts its own rules after the user\'s, since OpenCode lets the last matching rule win', () => {
    const user = { permission: { '*': 'allow', read: 'allow' }, agent: { build: { permission: { '*': 'allow', bash: 'allow' } } } };
    const c = config(openCodeEnv({ OPENCODE_CONFIG_CONTENT: JSON.stringify(user) }, { savedKey: false }));
    expect(Object.entries(c.permission)).toEqual([
      ['*', 'allow'], ['read', 'allow'], ['edit', 'ask'], ['bash', 'ask'], ['webfetch', 'ask'], ['task', 'deny'],
    ]);
    expect(Object.keys(c.agent.build.permission)).toEqual(['*', 'edit', 'bash', 'webfetch', 'task']);
  });

  it('gives each process its own server password', () => {
    const a = openCodeEnv({}, { savedKey: false }).OPENCODE_SERVER_PASSWORD;
    const b = openCodeEnv({}, { savedKey: false }).OPENCODE_SERVER_PASSWORD;
    expect(a).toMatch(/^[\w-]{32}$/);
    expect(a).not.toBe(b);
  });

  it('starts on DeepSeek V4.1 Flash only when the OpenRouter key is the one saved in Grove', () => {
    expect(config(openCodeEnv({}, { savedKey: true }))).toMatchObject({ model: OPENCODE_DEFAULT_MODEL, small_model: OPENCODE_DEFAULT_MODEL });
    const own = config(openCodeEnv({ OPENROUTER_API_KEY: 'from-shell' }, { savedKey: false }));
    expect(own).not.toHaveProperty('model');
    expect(own).not.toHaveProperty('small_model');
  });

  it('keeps the user\'s own inline config, but not a permission that skips asking', () => {
    const user = {
      model: 'anthropic/claude-x',
      mcp: { docs: { type: 'remote', url: 'https://example.com' } },
      permission: { edit: 'allow', bash: { 'git *': 'allow' }, external_directory: 'ask' },
      agent: { build: { temperature: 0.2 }, plan: { model: 'm', permission: { bash: 'allow', read: 'deny' } }, review: { model: 'r' } },
    };
    const c = config(openCodeEnv({ OPENCODE_CONFIG_CONTENT: JSON.stringify(user) }, { savedKey: true }));
    expect(c.model).toBe('anthropic/claude-x');
    expect(c.small_model).toBe(OPENCODE_DEFAULT_MODEL);
    expect(c.mcp).toEqual(user.mcp);
    const asking = { edit: 'ask', bash: 'ask', webfetch: 'ask', task: 'deny' };
    expect(c.permission).toEqual({ ...asking, external_directory: 'ask' });
    expect(c.agent).toEqual({
      build: { temperature: 0.2, permission: asking },
      plan: { model: 'm', permission: { ...asking, read: 'deny', edit: 'deny' } },
      review: { model: 'r' },
    });
  });

  it('ignores inline config that isn\'t a JSON object', () => {
    for (const bad of ['not json', '[1,2]', 'null']) {
      expect(config(openCodeEnv({ OPENCODE_CONFIG_CONTENT: bad }, { savedKey: false })).permission.edit).toBe('ask');
    }
  });
});

describe('verifyOpenRouterKey', () => {
  const answering = (status: number) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status }));

  it('asks OpenRouter about the key with it as a bearer token', async () => {
    const fetchFn = answering(200);
    await expect(verifyOpenRouterKey('sk-test', { fetchFn })).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.objectContaining({
      headers: { Authorization: 'Bearer sk-test' },
    }));
  });

  it('refuses a key OpenRouter refuses, and can\'t tell otherwise', async () => {
    await expect(verifyOpenRouterKey('k', { fetchFn: answering(401) })).resolves.toBe(false);
    await expect(verifyOpenRouterKey('k', { fetchFn: answering(403) })).resolves.toBe(false);
    await expect(verifyOpenRouterKey('k', { fetchFn: answering(503) })).resolves.toBeNull();
    await expect(verifyOpenRouterKey('k', { fetchFn: vi.fn(async () => { throw new Error('offline'); }) })).resolves.toBeNull();
  });
});
