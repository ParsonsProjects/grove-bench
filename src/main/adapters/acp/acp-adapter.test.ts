import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AcpAdapter, type AcpAgentDefinition } from './acp-adapter.js';
import type { AdapterConfig, AdapterEvent, AgentQueryHandle, PermissionRequest, PermissionResponse } from '../types.js';

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
const catalog = new Map<string, unknown[]>();
vi.mock('../../app-state.js', () => ({
  loadModelCatalog: (id: string) => catalog.get(id) ?? null,
  saveModelCatalog: (id: string, models: unknown[]) => { catalog.set(id, models); },
}));

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
    expect(JSON.parse((told.find((e) => e.type === 'assistant_text') as { text: string }).text)).toEqual([
      { type: 'stdio', name: 'grove-memory', env: ['ELECTRON_RUN_AS_NODE', 'GROVE_MCP_URL', 'GROVE_MCP_AUTHORIZATION'] },
    ]);

    // The fake agent starts the bridge as a real process and calls memory_read.
    handle.sendMessage({ text: 'mcp-call' });
    const called = await until(handle, 'result');
    expect((called.find((e) => e.type === 'assistant_text') as { text: string }).text).toBe('# Overview');
    handle.close();
  });

  it('says how to sign in when the agent needs it', async () => {
    const adapter = new AcpAdapter(def('auth'));
    const handle = await adapter.start(config());
    const events: AdapterEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('Run "fake" in a terminal') });
  });

  it('reports a program that does not start', async () => {
    const adapter = new AcpAdapter({ ...def(), command: 'definitely-not-an-acp-agent-xyz' });
    const handle = await adapter.start(config());
    const events: AdapterEvent[] = [];
    for await (const e of handle.events) events.push(e);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect((await adapter.checkPrerequisites()).available).toBe(false);
  });

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

  it('finds an agent given by full path', async () => {
    const adapter = new AcpAdapter({ ...def(), command: process.execPath });
    expect(await adapter.checkPrerequisites()).toMatchObject({ available: true, path: process.execPath });
    const missing = new AcpAdapter({ ...def(), command: path.join(cwd, 'no-such-agent.exe') });
    expect((await missing.checkPrerequisites()).available).toBe(false);
  });

  it('generates one-off text with tool requests turned down', async () => {
    const adapter = new AcpAdapter(def());
    const text = await adapter.generateText('You write commit messages.', 'diff here', { cwd, model: 'm2' });
    expect(text).toBe('Fix the thing (no, m2)');
  });
});
