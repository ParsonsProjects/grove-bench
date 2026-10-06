import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AcpAdapter, type AcpAgentDefinition } from './acp-adapter.js';
import type { AdapterConfig, AdapterEvent, AgentQueryHandle, PermissionRequest, PermissionResponse } from '../types.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
const savedKeys = vi.hoisted(() => new Map<string, string>());
vi.mock('../../credentials.js', () => ({ getApiKey: (id: string) => savedKeys.get(id) ?? null }));
const catalog = new Map<string, unknown[]>();
const signIn = new Map<string, { signedIn: boolean; message?: string; checkedAt: number }>();
vi.mock('../../app-state.js', () => ({
  loadModelCatalog: (id: string) => catalog.get(id) ?? null,
  saveModelCatalog: (id: string, models: unknown[]) => { catalog.set(id, models); },
  loadAgentSignIn: (id: string) => signIn.get(id) ?? null,
  saveAgentSignIn: (id: string, record: { signedIn: boolean; message?: string; checkedAt: number }) => { signIn.set(id, record); },
}));

const savedMcp = vi.hoisted(() => [] as import('./mcp-servers.js').AcpMcpServerConfig[]);
vi.mock('./mcp-servers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mcp-servers.js')>()),
  savedAcpMcpServers: () => savedMcp,
}));

const registry = new Map<string, unknown>();
const models = new Map<string, { context?: number }>();
vi.mock('../../catalogs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../catalogs.js')>();
  return {
    ...actual,
    catalogs: {
      registryAgent: (id?: string) => (id ? registry.get(id) ?? null : null),
      model: (id: string, provider?: string) => models.get(`${provider ?? ''}:${id}`) ?? null,
      onChange: () => () => {},
    },
  };
});

/** For tests that start several real processes, or one that doesn't exist:
 *  on Windows a missing program goes through cmd.exe and where.exe, which
 *  on CI runners can take longer than the 5 s default. */
const SPAWNS_TIMEOUT_MS = 20_000;

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-acp-agent.test-fixture.mjs');

function def(scenario = 'default'): AcpAgentDefinition {
  return {
    id: 'fake-acp',
    displayName: 'Fake Agent',
    command: process.execPath,
    args: [FIXTURE],
    env: { FAKE_ACP_SCENARIO: scenario },
    cliSignIn: { accountLabel: 'Fake account', cliName: 'Fake CLI', command: 'fake', setupUrl: 'https://example.com' },
  };
}

let cwd: string;
beforeEach(() => {
  catalog.clear();
  signIn.clear();
  registry.clear();
  models.clear();
  savedKeys.clear();
  savedMcp.length = 0;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-test-'));
});

function config(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    cwd,
    permissionMode: 'default',
    onPermissionRequest: async () => ({ behavior: 'allow', updatedInput: {} }),
    toolAllowRules: [],
    toolDenyRules: [],
    alwaysAllowedTools: new Set(),
    ...overrides,
  };
}

/** Read events until one of `type` arrives (inclusive). */
async function until(handle: AgentQueryHandle, type: AdapterEvent['type'], seen: AdapterEvent[] = []): Promise<AdapterEvent[]> {
  const it = handle.events[Symbol.asyncIterator]();
  for (;;) {
    const next = await it.next();
    if (next.done) throw new Error(`events ended before ${type}; saw ${seen.map((e) => e.type).join(', ')}`);
    seen.push(next.value);
    if (next.value.type === type) return seen;
  }
}

describe('AcpAdapter', () => {
  it('gives each turn its share of the session\'s running cost, and its output tokens', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');

    handle.sendMessage({ text: 'cost' });
    const first = await until(handle, 'result');
    handle.sendMessage({ text: 'cost' });
    const second = await until(handle, 'result');

    expect(first.at(-1)).toMatchObject({ type: 'result', totalCostUsd: 0.01 });
    expect((second.at(-1) as { totalCostUsd: number }).totalCostUsd).toBeCloseTo(0.01, 10);
    expect(first.filter((e) => e.type === 'usage').at(-1)).toEqual({ type: 'usage', inputTokens: 900, outputTokens: 40 });
    handle.close();
  });

  it('reports controls the agent changes by itself', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');

    handle.sendMessage({ text: 'self-mode' });
    const turn = await until(handle, 'result');

    const changes = turn.filter((e) => e.type === 'agent_controls');
    expect(changes).toEqual([
      { type: 'agent_controls', values: { 'acp:mode': 'yolo' } },
      { type: 'agent_controls', values: { 'acp:effort': 'high' } },
    ]);
    handle.close();
  });

  it('starts a session, streams a turn and asks before an edit', async () => {
    const adapter = new AcpAdapter(def());
    const asked: PermissionRequest[] = [];
    const handle = await adapter.start(config({
      onPermissionRequest: async (req): Promise<PermissionResponse> => {
        asked.push(req);
        return { behavior: 'allow', updatedInput: {} };
      },
    }));

    const init = await until(handle, 'system_init');
    expect(init.at(-1)).toMatchObject({ type: 'system_init', sessionId: 's1', model: 'm1', slashCommands: ['compress'] });
    expect(handle.getSessionId()).toBe('s1');

    handle.sendMessage({ text: 'write a file' });
    const turn = await until(handle, 'result');

    expect(turn.find((e) => e.type === 'thinking')).toMatchObject({ thinking: 'Thinking it over' });
    expect(turn.find((e) => e.type === 'assistant_text')).toMatchObject({ text: 'Hello world', uuid: 'a1' });

    // The edit: reported, filled in by the permission request, asked about, finished.
    const use = turn.find((e) => e.type === 'assistant_tool_use' && e.toolUseId === 't1');
    expect(use).toMatchObject({ toolName: 'write_file', toolCategory: 'edit', toolView: { kind: 'edit', path: 'a.txt', summary: 'Write a.txt' } });
    const filled = turn.find((e) => e.type === 'tool_update' && e.toolUseId === 't1');
    expect(filled).toMatchObject({ toolView: { kind: 'edit', path: 'a.txt', write: 'hi' } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ toolName: 'write_file', toolUseId: 't1', toolCategory: 'edit', toolView: { kind: 'edit', write: 'hi' } });
    expect(turn.find((e) => e.type === 'tool_result' && e.toolUseId === 't1')).toMatchObject({ isError: false, content: 'Created ' + path.join(cwd, 'a.txt') });

    // The plan is one call, finished with the turn.
    const planUse = turn.find((e) => e.type === 'assistant_tool_use' && e.toolName === 'plan');
    expect(planUse).toBeTruthy();
    const planId = (planUse as { toolUseId: string }).toolUseId;
    expect(turn.find((e) => e.type === 'tool_result' && e.toolUseId === planId)).toMatchObject({ isError: false, content: '[x] Write a.txt' });

    expect(turn.find((e) => e.type === 'usage')).toMatchObject({ inputTokens: 1200 });
    expect(turn.at(-1)).toMatchObject({ type: 'result', subtype: 'success', isError: false, numTurns: 1, contextWindow: 100000 });
    expect(await adapter.getConversationTitle('s1')).toBe('Writing a file');

    handle.close();
  });

  it('learns the agent\'s models and controls from the session', async () => {
    const adapter = new AcpAdapter(def());
    const changed = vi.fn();
    adapter.onModelsChanged(changed);
    const handle = await adapter.start(config());
    await until(handle, 'system_init');

    expect(adapter.getModels()).toEqual([{ id: 'm1', label: 'Model 1' }, { id: 'm2', label: 'Model 2' }]);
    const controls = adapter.getControls();
    expect(controls.map((c) => c.id)).toEqual(['permissionMode', 'acp:mode', 'acp:effort']);
    expect(controls[0].options.map((o) => o.value)).toEqual(['default', 'acceptEdits', 'readSafe']);
    expect(changed).toHaveBeenCalled();

    await handle.setModel!('m2');
    handle.sendMessage({ text: 'You write commit messages. go' });
    const turn = await until(handle, 'result');
    expect(turn.find((e) => e.type === 'assistant_text')).toMatchObject({ text: 'Fix the thing (ok, m2)' });
    handle.close();
  });

  it('approves edits inside the worktree in Edit mode without asking', async () => {
    const adapter = new AcpAdapter(def());
    const onPermissionRequest = vi.fn(async (): Promise<PermissionResponse> => ({ behavior: 'deny', message: 'no' }));
    const handle = await adapter.start(config({ permissionMode: 'acceptEdits', onPermissionRequest }));
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'write a file' });
    const turn = await until(handle, 'result');
    expect(onPermissionRequest).not.toHaveBeenCalled();
    expect(turn.find((e) => e.type === 'tool_result' && e.toolUseId === 't1')).toMatchObject({ isError: false });
    handle.close();
  });

  it('turns down a call a deny rule names, and reports the failed tool', async () => {
    const adapter = new AcpAdapter(def());
    const onPermissionRequest = vi.fn(async (): Promise<PermissionResponse> => ({ behavior: 'allow', updatedInput: {} }));
    const handle = await adapter.start(config({ toolDenyRules: [{ pattern: 'edit(a.txt)' }], onPermissionRequest }));
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'write a file' });
    const turn = await until(handle, 'result');
    expect(onPermissionRequest).not.toHaveBeenCalled();
    expect(turn.find((e) => e.type === 'tool_result' && e.toolUseId === 't1')).toMatchObject({ isError: true, content: 'Rejected' });
    handle.close();
  });

  it('cancels a running turn and finishes its open tool calls', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'wait' });
    const seen = await until(handle, 'assistant_tool_use');
    await handle.interrupt!();
    const rest = await until(handle, 'result', seen);
    expect(rest.find((e) => e.type === 'tool_result' && e.toolUseId === 'slow')).toMatchObject({ isError: true, content: 'Cancelled' });
    expect(rest.at(-1)).toMatchObject({ type: 'result', isError: false });
    handle.close();
  });

  it('resumes a conversation with session/load without replaying it into the thread', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config({ resumeSessionId: 'old-session' }));
    const events = await until(handle, 'system_init');
    expect(events.at(-1)).toMatchObject({ sessionId: 'old-session' });
    expect(events.some((e) => e.type === 'partial_text' || e.type === 'assistant_text')).toBe(false);
    handle.close();
  });

  it('serves Grove\'s tools to the agent over authenticated HTTP', async () => {
    const adapter = new AcpAdapter(def());
    const memoryOperations = { list: () => [], read: () => null, write: () => {}, delete: () => false };
    const handle = await adapter.start(config({ memoryOperations }));
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'mcp' });
    const turn = await until(handle, 'result');
    const text = (turn.find((e) => e.type === 'assistant_text') as { text: string }).text;
    expect(JSON.parse(text)).toEqual([{ type: 'http', name: 'grove-memory', auth: true }]);
    handle.close();
  });

  it('gives the agent the MCP servers saved for ACP agents, leaving out what it can\'t connect to', async () => {
    savedMcp.push(
      { name: 'files', transport: 'stdio', commandOrUrl: process.execPath, env: { TOKEN: 'abc' } },
      { name: 'docs', transport: 'http', commandOrUrl: 'https://example.com/mcp', headers: ['Authorization: Bearer x'] },
      { name: 'old', transport: 'sse', commandOrUrl: 'https://example.com/sse' },
      { name: 'theirs', transport: 'stdio', commandOrUrl: process.execPath, repoPath: '/repo/other' },
    );
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config({ repoPath: '/repo/mine' }));
    const started = await until(handle, 'system_init');
    expect(started.find((e) => e.type === 'status')).toMatchObject({
      level: 'warning',
      message: "Fake Agent can't connect to SSE MCP servers, so it starts without old.",
    });
    handle.sendMessage({ text: 'mcp' });
    const turn = await until(handle, 'result');
    expect(JSON.parse((turn.find((e) => e.type === 'assistant_text') as { text: string }).text)).toEqual([
      { type: 'stdio', name: 'files', env: ['TOKEN'] },
      { type: 'http', name: 'docs', auth: true },
    ]);
    handle.close();
  });

  it('sends Grove\'s instructions ahead of the first prompt of a new session', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config({ appendSystemPrompt: 'Use relative paths.' }));
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'echo' });
    const first = await until(handle, 'result');
    expect((first.find((e) => e.type === 'assistant_text') as { text: string }).text)
      .toBe('Instructions from Grove Bench, the app running this conversation:\n\nUse relative paths.|echo');
    handle.sendMessage({ text: 'echo' });
    const second = await until(handle, 'result');
    expect((second.find((e) => e.type === 'assistant_text') as { text: string }).text).toBe('echo');
    handle.close();
  });

  it('starts Grove\'s stdio bridge for an agent without HTTP MCP, and its tools work', async () => {
    const adapter = new AcpAdapter(def('nohttp'));
    const memoryOperations = {
      list: () => [],
      read: (p: string) => (p === 'repo/overview.md' ? '# Overview' : null),
      write: () => {},
      delete: () => false,
    };
    const handle = await adapter.start(config({ memoryOperations }));
    await until(handle, 'system_init');

    handle.sendMessage({ text: 'mcp' });
    const told = await until(handle, 'result');
    const env = ['ELECTRON_RUN_AS_NODE', 'GROVE_MCP_URL', 'GROVE_MCP_AUTHORIZATION'];
    // On Windows the bridge also gets SystemRoot (see launch.ts).
    if (process.platform === 'win32' && process.env.SystemRoot) env.push('SystemRoot');
    expect(JSON.parse((told.find((e) => e.type === 'assistant_text') as { text: string }).text)).toEqual([
      { type: 'stdio', name: 'grove-memory', env },
    ]);

    // The fake agent starts the bridge as a real process and calls memory_read.
    handle.sendMessage({ text: 'mcp-call' });
    const called = await until(handle, 'result');
    expect((called.find((e) => e.type === 'assistant_text') as { text: string }).text).toBe('# Overview');
    handle.close();
  });

  it('says how to sign in when the agent needs it, and remembers it is signed out', async () => {
    const adapter = new AcpAdapter(def('auth'));
    const handle = await adapter.start(config());
    const events: AdapterEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ auth: true, message: expect.stringContaining('Run "fake" in a terminal') });
    expect(await adapter.checkPrerequisites()).toMatchObject({ available: true, authenticated: false, authMessage: 'Authentication required' });
  });

  it('passes on the agent\'s reason, and signs in with the saved key when the agent offers that', async () => {
    const keyDef: AcpAgentDefinition = { ...def('keyauth'), apiKey: { envVar: 'FAKE_KEY_VAR', label: 'Fake key', helpUrl: 'https://example.com', authMethodId: 'fake-api-key' } };

    const withoutKey = await new AcpAdapter(keyDef).start(config());
    const failed: AdapterEvent[] = [];
    for await (const e of withoutKey.events) failed.push(e);
    expect(failed.find((e) => e.type === 'error')).toMatchObject({
      auth: true,
      message: expect.stringMatching(/^Fake Agent needs you to sign in: This client is no longer supported\. Run "fake".*or save a Fake key/),
    });

    // A saved key the agent turns down is flagged, so new threads ask again.
    savedKeys.set('fake-acp', 'bad-key');
    const refused = await new AcpAdapter(keyDef).start(config());
    const refusedEvents: AdapterEvent[] = [];
    for await (const e of refused.events) refusedEvents.push(e);
    expect(refusedEvents.find((e) => e.type === 'error')).toMatchObject({ auth: true, keyRejected: true });

    savedKeys.set('fake-acp', 'good-key');
    const adapter = new AcpAdapter(keyDef);
    const handle = await adapter.start(config());
    await until(handle, 'system_init');
    expect(signIn.get('fake-acp')?.signedIn).toBe(true);
    handle.close();
  }, SPAWNS_TIMEOUT_MS);

  it('checks sign-in by opening a session it throws away', async () => {
    expect(await new AcpAdapter(def()).checkSignIn!()).toEqual({ signedIn: true });
    expect(await new AcpAdapter(def('auth')).checkSignIn!()).toEqual({ signedIn: false, message: 'Authentication required' });
    expect(signIn.get('fake-acp')).toMatchObject({ signedIn: false });
    // An agent without Check sign-in isn't held back by an old refusal.
    expect(await new AcpAdapter({ ...def(), command: process.execPath, cliSignIn: undefined }).checkPrerequisites()).toMatchObject({ authenticated: true, authUnchecked: true });
    // Agents without a CLI sign-in aren't started just to check.
    expect(new AcpAdapter({ ...def(), cliSignIn: undefined }).checkSignIn).toBeUndefined();
  }, SPAWNS_TIMEOUT_MS);

  it('learns the agent\'s models and controls from Check sign-in', async () => {
    const adapter = new AcpAdapter(def());
    const changed = vi.fn();
    adapter.onModelsChanged(changed);
    expect(adapter.getControls().map((c) => c.id)).toEqual(['permissionMode']);
    expect(adapter.getModels()).toEqual([]);

    expect(await adapter.checkSignIn!()).toEqual({ signedIn: true });
    expect(adapter.getModels().map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(adapter.getControls().map((c) => c.id)).toEqual(['permissionMode', 'acp:mode', 'acp:effort']);
    expect(changed).toHaveBeenCalled();
    // Kept for the next launch, like a thread's.
    expect(new AcpAdapter(def()).getControls('m1').map((c) => c.id)).toEqual(['permissionMode', 'acp:mode', 'acp:effort']);
  }, SPAWNS_TIMEOUT_MS);

  it('can\'t tell whether a program that doesn\'t start is signed in', async () => {
    expect((await new AcpAdapter({ ...def(), command: 'definitely-not-an-acp-agent-xyz' }).checkSignIn!()).signedIn).toBeNull();
  }, SPAWNS_TIMEOUT_MS);

  it('reports a program that does not start', async () => {
    const adapter = new AcpAdapter({ ...def(), command: 'definitely-not-an-acp-agent-xyz' });
    const handle = await adapter.start(config());
    const events: AdapterEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect((await adapter.checkPrerequisites()).available).toBe(false);
  }, SPAWNS_TIMEOUT_MS);

  it('keeps the agent\'s own defaults when a conversation changes a control', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');
    await handle.setControl!('acp:mode', 'yolo');
    await handle.setControl!('acp:effort', 'high');
    const defaults = Object.fromEntries(adapter.getControls().map((c) => [c.id, c.default]));
    expect(defaults).toMatchObject({ 'acp:mode': 'default', 'acp:effort': 'low' });
    handle.close();
  });

  it('keeps each model\'s own options, and where a new thread on it starts', async () => {
    const effort = (a: AcpAdapter, model?: string) => a.getControls(model).find((c) => c.id === 'acp:effort');
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');
    // Switching before anything else changed, as a new thread on m2 does:
    // where the agent puts m2's options is where they start.
    await handle.setModel!('m2');
    expect(effort(adapter, 'm2')).toMatchObject({ default: 'max', options: [{ value: 'high' }, { value: 'max' }] });
    // Later choices aren't starts, on m2 or on m1.
    await handle.setControl!('acp:effort', 'high');
    await handle.setControl!('acp:mode', 'yolo');
    await handle.setModel!('m1');
    expect(effort(adapter, 'm2')?.default).toBe('max');
    expect(effort(adapter, 'm1')).toMatchObject({ default: 'low', options: [{ value: 'low' }, { value: 'high' }] });
    expect(adapter.getControls('m1').find((c) => c.id === 'acp:mode')?.default).toBe('default');
    handle.close();

    const relaunched = new AcpAdapter(def());
    expect(effort(relaunched, 'm2')?.default).toBe('max');
    expect(effort(relaunched, 'm1')?.default).toBe('low');
  });

  it('doesn\'t take a model\'s start from a thread that changed something first', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    await until(handle, 'system_init');
    // The fake agent keeps effort across a switch when the new model has it.
    await handle.setControl!('acp:effort', 'high');
    await handle.setModel!('m2');
    handle.close();
    // m2 wasn't seen untouched, so it gets the last options seen, as a guess.
    const relaunched = new AcpAdapter(def());
    expect(relaunched.getControls('m2').find((c) => c.id === 'acp:effort')?.options.map((o) => o.value)).toEqual(['high', 'max']);
    // A new thread on m2 then shows its real start.
    const next = await relaunched.start(config({ model: 'm2' }));
    await until(next, 'system_init');
    expect(relaunched.getControls('m2').find((c) => c.id === 'acp:effort')?.default).toBe('max');
    next.close();
  });

  it('reads options saved before they were kept per model', () => {
    const effort = { id: 'acp:effort', label: 'Effort', options: [{ value: 'low', label: 'Low' }], default: 'low' };
    catalog.set('fake-acp', [{ models: [{ id: 'm1', label: 'Model 1' }], controls: [effort], byModel: 'junk' }]);
    expect(new AcpAdapter(def()).getControls('m1').map((c) => c.id)).toEqual(['permissionMode', 'acp:effort']);
  });

  it('runs messages queued during start-up one at a time', async () => {
    const adapter = new AcpAdapter(def());
    const handle = await adapter.start(config());
    // Both arrive before the session is ready; the fake agent refuses overlap.
    handle.sendMessage({ text: 'echo' });
    handle.sendMessage({ text: 'echo' });
    const first = await until(handle, 'result');
    const second = await until(handle, 'result');
    expect(first.at(-1)).toMatchObject({ isError: false });
    expect(second.at(-1)).toMatchObject({ isError: false });
    handle.close();
  });

  it('asks about a command the agent only titled, whatever the shell rules say', async () => {
    const adapter = new AcpAdapter(def());
    const asked: PermissionRequest[] = [];
    const handle = await adapter.start(config({
      toolAllowRules: [{ pattern: 'shell(npm test*)' }],
      onPermissionRequest: async (req) => {
        asked.push(req);
        return { behavior: 'deny', message: 'no' };
      },
    }));
    await until(handle, 'system_init');
    handle.sendMessage({ text: 'titled-exec' });
    const turn = await until(handle, 'result');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ toolName: 'execute', toolCategory: 'bash', toolView: { kind: 'other', summary: 'npm test' } });
    expect(turn.find((e) => e.type === 'tool_result' && e.toolUseId === 'e1')).toMatchObject({ isError: true });
    handle.close();
  });

  it('takes the install command from the ACP Registry, and context sizes from models.dev', async () => {
    const missing = path.join(cwd, 'no-such-agent.exe');
    const listed: AcpAgentDefinition = { ...def(), command: missing, registryId: 'fake', modelProvider: 'fakeco', installCommand: 'npm install -g fake-old' };
    expect((await new AcpAdapter(listed).checkPrerequisites()).installCommand).toBe('npm install -g fake-old');
    registry.set('fake', { id: 'fake', name: 'Fake', version: '2.0.0', distribution: { npx: { package: 'fake-agent@2.0.0', args: ['--acp'] } } });
    expect((await new AcpAdapter(listed).checkPrerequisites()).installCommand).toBe('npm install -g fake-agent@2.0.0');

    catalog.set('fake-acp', [{ models: [{ id: 'm1', label: 'Model 1' }, { id: 'm2', label: 'Model 2' }], controls: [] }]);
    models.set('fakeco:m1', { context: 1_000_000 });
    expect(new AcpAdapter(listed).getModels()).toEqual([
      { id: 'm1', label: 'Model 1', contextWindow: 1_000_000 },
      { id: 'm2', label: 'Model 2' },
    ]);
  });

  it('finds an agent given by full path', async () => {
    const adapter = new AcpAdapter({ ...def(), command: process.execPath });
    // Signing in only shows when a session starts.
    expect(await adapter.checkPrerequisites()).toMatchObject({ available: true, path: process.execPath, authenticated: true, authUnchecked: true });
    const missing = new AcpAdapter({ ...def(), command: path.join(cwd, 'no-such-agent.exe') });
    expect((await missing.checkPrerequisites()).available).toBe(false);
  });

  it('generates one-off text with tool requests turned down', async () => {
    const adapter = new AcpAdapter(def());
    const text = await adapter.generateText('You write commit messages.', 'diff here', { cwd, model: 'm2' });
    expect(text).toBe('Fix the thing (no, m2)');
  });

  describe('an API key saved in Grove and per-process settings', () => {
    const keyed = (): AcpAgentDefinition => ({
      ...def(),
      apiKey: { envVar: 'FAKE_KEY_VAR', label: 'Fake key', helpUrl: 'https://example.com' },
      spawnEnv: (env, { savedKey }) => ({ FAKE_SPAWN: `${savedKey ? 'saved' : 'not saved'}:${env.FAKE_KEY_VAR ?? 'none'}` }),
    });

    it('reach the agent, the saved key over an inherited one, in conversations and background tasks', async () => {
      savedKeys.set('fake-acp', 'k-saved');
      vi.stubEnv('FAKE_KEY_VAR', 'k-inherited');
      try {
        const adapter = new AcpAdapter(keyed());
        expect(adapter.apiKey).toMatchObject({ envVar: 'FAKE_KEY_VAR' });
        const handle = await adapter.start(config());
        await until(handle, 'system_init');
        handle.sendMessage({ text: 'env' });
        const text = (await until(handle, 'result')).find((e) => e.type === 'assistant_text');
        expect(JSON.parse((text as { text: string }).text)).toEqual({ key: 'k-saved', spawn: 'saved:k-saved' });
        handle.close();

        expect(JSON.parse(await adapter.generateText('sys', 'env', { cwd }))).toEqual({ key: 'k-saved', spawn: 'saved:k-saved' });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('leave an inherited key alone when none is saved', async () => {
      vi.stubEnv('FAKE_KEY_VAR', 'k-inherited');
      try {
        const text = await new AcpAdapter(keyed()).generateText('sys', 'env', { cwd });
        expect(JSON.parse(text)).toEqual({ key: 'k-inherited', spawn: 'not saved:k-inherited' });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('an agent that edits and runs commands without asking', () => {
    const warnings = (events: AdapterEvent[]) =>
      events.filter((e): e is Extract<AdapterEvent, { type: 'status' }> => e.type === 'status' && /without asking/.test(e.message));

    it('warns once, naming the mode its edits and commands went past', async () => {
      const asked: PermissionRequest[] = [];
      const handle = await adapter().start(config({ onPermissionRequest: async (req) => { asked.push(req); return { behavior: 'allow', updatedInput: {} }; } }));
      await until(handle, 'system_init');
      handle.sendMessage({ text: 'unasked' });
      const turn = await until(handle, 'result');
      handle.sendMessage({ text: 'unasked' });
      const second = await until(handle, 'result');

      expect(asked).toHaveLength(0);
      expect(warnings([...turn, ...second])).toHaveLength(1);
      expect(warnings(turn)[0].message).toContain('Fake Agent ran "b.txt" without asking, so the Ask mode and your tool rules don\'t apply');
      handle.close();
    });

    it('says when a deny rule did not stop it', async () => {
      const handle = await adapter().start(config({ permissionMode: 'acceptEdits', toolDenyRules: [{ pattern: 'shell(rm *)' }] }));
      await until(handle, 'system_init');
      handle.sendMessage({ text: 'unasked' });
      const [warning] = warnings(await until(handle, 'result'));
      // The edit inside the worktree is what Edit mode allows; the command is the one.
      expect(warning.message).toContain('ran "rm -rf build" without asking, though one of your tool rules denies it');
      handle.close();
    });

    it('says when the conversation doesn\'t allow the tool', async () => {
      const handle = await adapter().start(config({ allowedTools: new Set(['read']) }));
      await until(handle, 'system_init');
      handle.sendMessage({ text: 'unasked' });
      const [warning] = warnings(await until(handle, 'result'));
      expect(warning.message).toContain('ran "b.txt" without asking, though this thread doesn\'t allow that tool');
      handle.close();
    });

    it('doesn\'t count calls replayed from an earlier conversation', async () => {
      const handle = await adapter().start(config({ resumeSessionId: 'old-session' }));
      expect(warnings(await until(handle, 'system_init'))).toHaveLength(0);
      handle.sendMessage({ text: 'unasked' });
      const [warning, ...more] = warnings(await until(handle, 'result'));
      expect(more).toHaveLength(0);
      expect(warning.message).toContain('ran "b.txt" without asking');
      handle.close();
    });

    it('stays quiet about a read-only command in Read-safe mode, which would have allowed it', async () => {
      for (const [permissionMode, expected] of [['readSafe', 0], ['default', 1]] as const) {
        const handle = await adapter().start(config({ permissionMode }));
        await until(handle, 'system_init');
        handle.sendMessage({ text: 'unasked-read' });
        expect(warnings(await until(handle, 'result'))).toHaveLength(expected);
        handle.close();
      }
    });

    it('stays quiet when Grove would have allowed everything it did', async () => {
      const handle = await adapter().start(config({ permissionMode: 'acceptEdits', toolAllowRules: [{ pattern: 'shell' }] }));
      await until(handle, 'system_init');
      handle.sendMessage({ text: 'unasked' });
      expect(warnings(await until(handle, 'result'))).toHaveLength(0);
      handle.close();
    });

    const adapter = () => new AcpAdapter(def());
  });
});
