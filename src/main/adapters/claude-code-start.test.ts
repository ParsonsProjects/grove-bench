/**
 * ClaudeCodeAdapter.start() on a stand-in SDK (setSdkForTests): the options
 * it asks the SDK for, the agent process its spawn hook starts, the events it
 * reads, its tool-call callback and its handle's calls into the query. What
 * those build on (the message transforms, the tool policy, the reasoning
 * options) has its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HostedProcess, type ProcessCommand } from '../process-host-spawn.js';
import { PERMISSION_TIMEOUT_MINUTES } from '../../shared/types.js';

const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn() }));
vi.mock('../process-host.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnProcess: hosted.spawnProcess,
}));
const credentials = vi.hoisted(() => ({ getApiKey: vi.fn((_id: string): string | null => null) }));
vi.mock('../credentials.js', () => credentials);
vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// Grove's tool servers, as the SDK would make them.
const servers = vi.hoisted(() => ({
  createMemoryMcpServer: vi.fn((_operations: unknown) => Promise.resolve({ server: 'grove-memory' })),
  createPreviewMcpServer: vi.fn((_operations: unknown) => Promise.resolve({ server: 'grove-preview' })),
}));
vi.mock('./memory-mcp-server.js', () => ({ createMemoryMcpServer: servers.createMemoryMcpServer }));
vi.mock('./preview-mcp-server.js', () => ({ createPreviewMcpServer: servers.createPreviewMcpServer }));

import { ClaudeCodeAdapter, CONTEXT_1M_BETA, LIMIT_STOP_REASON, THINKING_LEVEL_TOKENS, setSdkForTests } from './claude-code.js';
import { ResumeNotFoundError, type AdapterConfig, type AdapterEvent, type AgentQueryHandle, type PermissionResponse } from './types.js';
import type { ClaudeAccount } from './claude-accounts.js';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** What start() hands the SDK's query(). */
interface QueryParams {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown> & {
    abortController: AbortController;
    env: Record<string, string | undefined>;
    canUseTool: (toolName: string, input: Record<string, unknown>, options: { toolUseID: string; decisionReason?: string; suggestions?: unknown[] }) => Promise<unknown>;
    spawnClaudeCodeProcess: (options: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal }) => HostedProcess;
  };
}

/** A stand-in for the SDK's Query: the messages a test sends it, then its
 *  end, and the controls a handle calls. */
function fakeQuery() {
  const queue: unknown[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const poke = () => { wake?.(); wake = null; };
  const q = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
    interrupt: vi.fn(() => Promise.resolve()),
    stopTask: vi.fn((_taskId: string) => Promise.resolve()),
    close: vi.fn(),
    setModel: vi.fn((_model: string) => Promise.resolve()),
    setPermissionMode: vi.fn((_mode: string) => Promise.resolve()),
    setMaxThinkingTokens: vi.fn((_tokens: number | null, _display?: string) => Promise.resolve()),
    applyFlagSettings: vi.fn((_settings: Record<string, unknown>) => Promise.resolve()),
    supportedModels: vi.fn(() => Promise.resolve([])),
  };
  return {
    q,
    send(message: unknown) { queue.push(message); poke(); },
    end() { ended = true; poke(); },
  };
}

// No default: a test that hasn't given start() its fake fails at once.
const query = vi.fn<(params: QueryParams) => unknown>();

function config(extra: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    cwd: '/repo/wt',
    permissionMode: 'default',
    onPermissionRequest: vi.fn(() => Promise.resolve<PermissionResponse>({ behavior: 'deny', message: 'no' })),
    toolAllowRules: [],
    toolDenyRules: [],
    alwaysAllowedTools: new Set(),
    ...extra,
  };
}

/** An adapter with no cached model list. */
const adapter = (account?: ClaudeAccount) => new ClaudeCodeAdapter({ load: () => undefined, save: () => {} }, account);

/** Start a query, and what start() asked the SDK for. */
async function start(extra: Partial<AdapterConfig> = {}, on = adapter()) {
  const fake = fakeQuery();
  query.mockImplementationOnce(() => fake.q);
  const started = config(extra);
  const handle = await on.start(started);
  const { prompt, options } = query.mock.calls.at(-1)![0];
  return { handle, fake, prompt, options, config: started };
}

/** Every event until the query ends, or what ended it. */
async function drain(handle: AgentQueryHandle): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

const init = (sessionId: string) => ({
  type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-4-8', tools: [], agents: [], skills: [],
  slash_commands: [], mcp_servers: [], apiKeySource: 'none', cwd: '/repo/wt', permissionMode: 'default', uuid: 'u1',
});

beforeEach(() => {
  setSdkForTests({ query } as never);
  // Reset, not cleared: a fake a failed start() left queued mustn't reach
  // the next test.
  query.mockReset();
  credentials.getApiKey.mockReset().mockReturnValue(null);
  hosted.spawnProcess.mockReset();
  servers.createMemoryMcpServer.mockClear();
  servers.createPreviewMcpServer.mockClear();
});

afterEach(() => {
  setSdkForTests(undefined);
  vi.unstubAllEnvs();
});

describe('ClaudeCodeAdapter.start(): what it asks the SDK for', () => {
  it('a query in the worktree, prompts streamed, with the mode, the tool-call callback and the spawn hook', async () => {
    const { prompt, options } = await start();
    expect(typeof prompt[Symbol.asyncIterator]).toBe('function');
    expect(options).toMatchObject({
      cwd: '/repo/wt',
      includePartialMessages: true,
      forwardSubagentText: true,
      perTaskStopAffordance: true,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      // No model: the CLI's default, which takes the 1M context beta.
      betas: [CONTEXT_1M_BETA],
    });
    expect(options.abortController).toBeInstanceOf(AbortController);
    expect(typeof options.canUseTool).toBe('function');
    expect(typeof options.spawnClaudeCodeProcess).toBe('function');
    const unset: (keyof Options)[] = [
      'model', 'resume', 'resumeSessionAt', 'forkSession', 'mcpServers', 'hooks', 'onElicitation', 'skills', 'sandbox',
      'settings', 'thinking', 'effort', 'promptSuggestions', 'outputFormat',
    ];
    for (const option of unset) expect(options).not.toHaveProperty(option);
  });

  it('runs Read-safe as acceptEdits, which the SDK has', async () => {
    expect((await start({ permissionMode: 'readSafe' })).options.permissionMode).toBe('acceptEdits');
    expect((await start({ permissionMode: 'plan' })).options.permissionMode).toBe('plan');
  });

  it('replaces the system prompt, or adds to Claude Code\'s', async () => {
    expect((await start({ customSystemPrompt: 'Be brief.' })).options.systemPrompt).toBe('Be brief.');
    expect((await start({ appendSystemPrompt: 'Project notes' })).options.systemPrompt)
      .toEqual({ type: 'preset', preset: 'claude_code', append: 'Project notes' });
  });

  it('starts the model it is given, with the 1M context beta where the model takes it', async () => {
    expect((await start({ model: 'claude-opus-4-8' })).options).toMatchObject({ model: 'claude-opus-4-8', betas: [CONTEXT_1M_BETA] });
    const haiku = (await start({ model: 'claude-haiku-4-5' })).options;
    expect(haiku.model).toBe('claude-haiku-4-5');
    expect(haiku).not.toHaveProperty('betas');
  });

  it('resumes a conversation, and forks it at a rewind point', async () => {
    const resumed = (await start({ resumeSessionId: 's1' })).options;
    expect(resumed.resume).toBe('s1');
    expect(resumed).not.toHaveProperty('forkSession');
    expect((await start({ resumeSessionId: 's1', resumeAtUuid: 'u9' })).options)
      .toMatchObject({ resume: 's1', resumeSessionAt: 'u9', forkSession: true });
    // A rewind point means nothing without a conversation to resume.
    const fresh = (await start({ resumeAtUuid: 'u9' })).options;
    expect(fresh).not.toHaveProperty('resumeSessionAt');
    expect(fresh).not.toHaveProperty('forkSession');
  });

  it('passes on the skills, output format, prompt suggestions and sandbox it is given', async () => {
    const outputFormat = { type: 'json_schema' as const, schema: { type: 'object' } };
    const { options } = await start({ skills: ['review'], outputFormat, promptSuggestions: true, sandbox: { enabled: true } });
    expect(options).toMatchObject({ skills: ['review'], outputFormat, promptSuggestions: true, sandbox: { enabled: true } });
  });

  it('turns the reasoning controls into thinking, effort and fast mode', async () => {
    const { options } = await start({ model: 'claude-opus-4-8', controls: { thinking: 'adaptive', effort: 'high', speed: 'fast' }, thinkingSummaries: false });
    expect(options).toMatchObject({ thinking: { type: 'adaptive', display: 'omitted' }, effort: 'high', settings: { fastMode: true } });
  });

  it("gives the agent Grove's environment, the saved key over a stale one, and the thread's own variables", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'stale-shell-key');
    vi.stubEnv('GROVE_TEST_INHERITED', 'kept');
    credentials.getApiKey.mockImplementation((id) => (id === 'claude-code' ? 'saved-key' : null));
    const { env } = (await start({ extraEnv: { GROVE_THREAD: '1' } })).options;
    expect(env).toMatchObject({
      GROVE_TEST_INHERITED: 'kept',
      ANTHROPIC_API_KEY: 'saved-key',
      CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
      GROVE_THREAD: '1',
    });
  });

  it("gives another account's agent its own folder, without Grove's sign-ins", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'default-account-key');
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/home/me/.claude');
    const work = { id: 'claude-account-work', name: 'Work', configDir: '/home/me/.claude-work' };
    const { env } = (await start({}, adapter(work))).options;
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-work');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it("gives another account's agent the key saved for that account", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'default-account-key');
    credentials.getApiKey.mockImplementation((id) => (id === 'claude-account-work' ? 'work-key' : 'default-key'));
    const work = { id: 'claude-account-work', name: 'Work', configDir: '/home/me/.claude-work' };
    expect((await start({}, adapter(work))).options.env.ANTHROPIC_API_KEY).toBe('work-key');
  });

  it("serves Grove's memory and Preview tools to the agent when the thread has them", async () => {
    const memoryOperations = { memory: true } as unknown as NonNullable<AdapterConfig['memoryOperations']>;
    const previewOperations = { preview: true } as unknown as NonNullable<AdapterConfig['previewOperations']>;
    expect((await start({ memoryOperations })).options.mcpServers).toEqual({ 'grove-memory': { server: 'grove-memory' } });
    expect(servers.createPreviewMcpServer).not.toHaveBeenCalled();
    expect((await start({ memoryOperations, previewOperations })).options.mcpServers).toEqual({
      'grove-memory': { server: 'grove-memory' },
      'grove-preview': { server: 'grove-preview' },
    });
    // Each server with its own operations.
    expect(servers.createMemoryMcpServer.mock.calls.map(([ops]) => ops)).toEqual([memoryOperations, memoryOperations]);
    expect(servers.createPreviewMcpServer.mock.calls[0][0]).toBe(previewOperations);
  });

  it('holds each tool call for the thread\'s limits, for longer than Grove waits for an answer', async () => {
    const beforeToolUse = vi.fn(() => Promise.resolve<'continue' | 'stop'>('stop'));
    const { options } = await start({ beforeToolUse });
    const [matcher] = (options.hooks as { PreToolUse: { hooks: ((input: unknown, id: string) => Promise<unknown>)[]; timeout: number }[] }).PreToolUse;
    expect(matcher.timeout).toBe(PERMISSION_TIMEOUT_MINUTES * 60 + 60);
    const decision = await matcher.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu1' }, 'tu1');
    expect(beforeToolUse).toHaveBeenCalledWith({ toolName: 'Bash', toolUseId: 'tu1' });
    expect(decision).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: LIMIT_STOP_REASON } });
  });

  it("puts an MCP server's question to the thread, passing back the content only with an accept", async () => {
    const onElicitation = vi.fn()
      .mockResolvedValueOnce({ action: 'accept', content: { name: 'x' } })
      .mockResolvedValueOnce({ action: 'decline', content: { name: 'ignored' } });
    const { options } = await start({ onElicitation });
    const ask = options.onElicitation as (request: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>;
    const { signal } = new AbortController();
    const request = { serverName: 'figma', message: 'Which file?', mode: 'form', requestedSchema: { type: 'object' } };

    expect(await ask(request, { signal })).toEqual({ action: 'accept', content: { name: 'x' } });
    expect(onElicitation).toHaveBeenCalledWith({ serverName: 'figma', message: 'Which file?', mode: 'form', requestedSchema: { type: 'object' } }, signal);
    expect(await ask(request, { signal })).toEqual({ action: 'decline' });
  });

  it('reads the model list from the CLI once a run', async () => {
    const on = adapter();
    const first = await start({}, on);
    const second = await start({}, on);
    expect(first.fake.q.supportedModels).toHaveBeenCalledOnce();
    expect(second.fake.q.supportedModels).not.toHaveBeenCalled();
  });
});

describe('ClaudeCodeAdapter.start(): the agent process', () => {
  /** The process the spawn hook starts, as the agent host reports it. Its
   *  label isn't an exe name, so processExe() must come from the command. */
  function spawned(options: QueryParams['options']) {
    const proc = new HostedProcess('the agent');
    const sent: ProcessCommand[] = [];
    proc.connect((command) => sent.push(command));
    hosted.spawnProcess.mockReturnValueOnce(proc);
    expect(options.spawnClaudeCodeProcess({ command: '/opt/sdk/claude', args: ['--output-format', 'stream-json'], cwd: '/repo/wt', env: {} })).toBe(proc);
    proc.receive({ type: 'spawned', id: 1, pid: 4242, launchMs: 5 });
    return { proc, sent };
  }

  it('has nothing to kill before the SDK has started it', async () => {
    const { handle } = await start();
    await expect(handle.killProcessTree!()).resolves.toBeUndefined();
    expect(handle.processId!()).toBeUndefined();
    expect(handle.processExe!()).toBeUndefined();
  });

  it('kills the tree of the process its spawn hook started, saying which pid', async () => {
    const { handle, options } = await start();
    const { proc, sent } = spawned(options);
    expect(hosted.spawnProcess).toHaveBeenCalledWith('/opt/sdk/claude', ['--output-format', 'stream-json'], { cwd: '/repo/wt', env: {} });
    expect(handle.processId!()).toBe(4242);
    expect(handle.processExe!()).toBe('claude.exe');

    const killed = handle.killProcessTree!();
    expect(sent).toEqual([{ type: 'kill-tree' }]);
    proc.receive({ type: 'tree-killed', id: 1, killed: true });
    await expect(killed).resolves.toBe(4242);
  });

  it('says no pid when there was nothing to kill, and passes a failed kill on', async () => {
    const nothing = await start();
    const first = spawned(nothing.options);
    const none = nothing.handle.killProcessTree!();
    first.proc.receive({ type: 'tree-killed', id: 1, killed: false });
    await expect(none).resolves.toBeUndefined();

    const failing = await start();
    const second = spawned(failing.options);
    const failed = failing.handle.killProcessTree!();
    second.proc.receive({ type: 'tree-killed', id: 1, killed: false, failure: 'taskkill 4242 failed: ERROR: Access is denied.' });
    await expect(failed).rejects.toThrow('taskkill 4242 failed: ERROR: Access is denied.');
  });

  it('gives no pid once the process has exited: Windows may give it to another', async () => {
    const { handle, options } = await start();
    const { proc } = spawned(options);
    proc.receive({ type: 'exit', id: 1, code: 0, signal: null });
    expect(handle.processId!()).toBeUndefined();
  });

  it('gives no pid once the process was lost with its host (no exit code, SIGKILL)', async () => {
    const { handle, options } = await start();
    const { proc } = spawned(options);
    proc.lost(true);
    expect(handle.processId!()).toBeUndefined();
  });
});

describe('ClaudeCodeAdapter.start(): the events', () => {
  it('takes the session id from the init message, and passes on what each message means', async () => {
    const { handle, fake } = await start();
    fake.send(init('sess-1'));
    fake.end();
    const events = await drain(handle);
    expect(events[0]).toMatchObject({ type: 'system_init', sessionId: 'sess-1' });
    expect(handle.getSessionId()).toBe('sess-1');
  });

  it('ends with ResumeNotFoundError when the conversation it resumes is gone', async () => {
    const { handle, fake } = await start({ resumeSessionId: 'gone' });
    fake.send({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID gone'] });
    await expect(drain(handle)).rejects.toBeInstanceOf(ResumeNotFoundError);
  });

  it('passes the same result on as it is when not resuming', async () => {
    const { handle, fake } = await start();
    fake.send({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID gone'] });
    fake.end();
    await expect(drain(handle)).resolves.toEqual([expect.objectContaining({
      type: 'result', subtype: 'error_during_execution', isError: true, errors: ['No conversation found with session ID gone'],
    })]);
  });

  it('stops reading once aborted', async () => {
    const { handle, fake, options } = await start();
    handle.abort();
    expect(options.abortController.signal.aborted).toBe(true);
    fake.send(init('sess-1'));
    // Ended, so a read that didn't stop shows the init rather than hanging.
    fake.end();
    await expect(drain(handle)).resolves.toEqual([]);
  });

  describe('the running cost and tokens', () => {
    const result = {
      type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 1, num_turns: 1,
      total_cost_usd: 7, modelUsage: { 'claude-opus-4-8': { inputTokens: 700, outputTokens: 70 } },
    };
    const prior = { priorCostUsd: 5, priorTokens: { input: 500, output: 50 } };

    it('count on from where a resumed conversation had reached', async () => {
      const { handle, fake } = await start({ resumeSessionId: 's1', ...prior });
      fake.send(result);
      fake.end();
      expect((await drain(handle))[0]).toMatchObject({
        totalCostUsd: 2, sessionCostUsd: 7,
        turnTokens: { input: 200, output: 20 }, sessionTokens: { input: 700, output: 70 },
      });
    });

    it("start from nothing in a new conversation, whatever an earlier one reached", async () => {
      const { handle, fake } = await start(prior);
      fake.send(result);
      fake.end();
      expect((await drain(handle))[0]).toMatchObject({
        totalCostUsd: 7, sessionCostUsd: 7,
        turnTokens: { input: 700, output: 70 }, sessionTokens: { input: 700, output: 70 },
      });
    });
  });
});

describe('ClaudeCodeAdapter.start(): tool calls', () => {
  const call = { toolUseID: 'tu1', decisionReason: 'Bash wants to run', suggestions: [{ type: 'addRules' }] };

  it('refuses a tool the thread may not use, without asking', async () => {
    const { options, config: started } = await start({ allowedTools: new Set(['Read']) });
    expect(await options.canUseTool('Bash', { command: 'ls' }, call)).toMatchObject({ behavior: 'deny' });
    expect(started.onPermissionRequest).not.toHaveBeenCalled();
  });

  it('allows one the user always allows, without asking, its input as it was', async () => {
    const onPermissionRequest = vi.fn();
    const { options } = await start({ alwaysAllowedTools: new Set(['Bash']), onPermissionRequest });
    expect(await options.canUseTool('Bash', { command: 'ls' }, call)).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(onPermissionRequest).not.toHaveBeenCalled();
  });

  it('asks the thread otherwise, and hands back an Always allow', async () => {
    const onPermissionRequest = vi.fn(() => Promise.resolve<PermissionResponse>({
      behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: call.suggestions,
    }));
    const { options } = await start({ onPermissionRequest });
    const answer = await options.canUseTool('Bash', { command: 'npm test' }, call);
    expect(onPermissionRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: '', toolName: 'Bash', toolUseId: 'tu1', toolInput: { command: 'npm test' },
      decisionReason: 'Bash wants to run', suggestions: call.suggestions, isPlanExecution: false, planText: undefined,
    }));
    expect(answer).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: call.suggestions });
  });

  it("refuses a write outside the sandbox's folders, even for a tool the user always allows", async () => {
    const onPermissionRequest = vi.fn();
    const { options } = await start({
      sandbox: { filesystem: { allowWrite: ['/repo/wt'] } }, alwaysAllowedTools: new Set(['Write']), onPermissionRequest,
    });
    expect(await options.canUseTool('Write', { file_path: '/etc/hosts', content: 'x' }, call))
      .toEqual({ behavior: 'deny', message: 'Path "/etc/hosts" is outside the allowed write directories' });
    expect(await options.canUseTool('Write', { file_path: 'src/a.ts', content: 'x' }, call))
      .toEqual({ behavior: 'allow', updatedInput: { file_path: 'src/a.ts', content: 'x' } });
    expect(onPermissionRequest).not.toHaveBeenCalled();
  });

  it('allows shell commands without asking in a sandbox that says so', async () => {
    const onPermissionRequest = vi.fn();
    const { options } = await start({ sandbox: { autoAllowBashIfSandboxed: true }, onPermissionRequest });
    expect(await options.canUseTool('Bash', { command: 'npm test' }, call)).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
    expect(onPermissionRequest).not.toHaveBeenCalled();
  });

  it('asks about a plan with its text', async () => {
    const onPermissionRequest = vi.fn(() => Promise.resolve<PermissionResponse>({ behavior: 'deny', message: 'Keep planning' }));
    const { options } = await start({ permissionMode: 'plan', onPermissionRequest });
    expect(await options.canUseTool('ExitPlanMode', { plan: '1. Fix it' }, call)).toEqual({ behavior: 'deny', message: 'Keep planning' });
    expect(onPermissionRequest).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'ExitPlanMode', isPlanExecution: true, planText: '1. Fix it' }));
  });
});

describe('ClaudeCodeAdapter.start(): the handle', () => {
  it('sends a message as a user turn, with the session id once it is known', async () => {
    const { handle, fake, prompt } = await start();
    const prompts = prompt[Symbol.asyncIterator]();
    handle.sendMessage({ text: 'hi' });
    expect((await prompts.next()).value).toEqual({ type: 'user', session_id: '', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });

    fake.send(init('sess-1'));
    const events = handle.events[Symbol.asyncIterator]();
    await events.next();
    handle.sendMessage({ text: 'again' });
    expect((await prompts.next()).value).toMatchObject({ session_id: 'sess-1', message: { content: 'again' } });
  });

  it('close ends the prompts and closes the query', async () => {
    const { handle, fake, prompt } = await start();
    handle.close();
    expect(fake.q.close).toHaveBeenCalledOnce();
    await expect(prompt[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true });
  });

  it('closeInput ends the prompts and leaves the query open', async () => {
    const { handle, fake, prompt } = await start();
    handle.closeInput!();
    handle.closeInput!();
    expect(fake.q.close).not.toHaveBeenCalled();
    await expect(prompt[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true });
  });

  it('interrupts the turn and stops a background task through the query', async () => {
    const { handle, fake } = await start();
    await handle.interrupt!();
    await handle.stopTask!('task-7');
    expect(fake.q.interrupt).toHaveBeenCalledOnce();
    expect(fake.q.stopTask).toHaveBeenCalledWith('task-7');
  });

  it('changes the model, and the mode, Read-safe as acceptEdits', async () => {
    const { handle, fake } = await start();
    await handle.setModel!('claude-sonnet-4-6');
    handle.setPermissionMode!('readSafe');
    handle.setPermissionMode!('plan');
    expect(fake.q.setModel).toHaveBeenCalledWith('claude-sonnet-4-6');
    expect(fake.q.setPermissionMode.mock.calls).toEqual([['acceptEdits'], ['plan']]);
  });

  it('sets thinking, effort and speed through the query, and refuses a control it lacks', async () => {
    const { handle, fake } = await start({ thinkingSummaries: true });
    await handle.setControl!('thinking', 'low');
    await handle.setControl!('thinking', 'off');
    await handle.setControl!('effort', 'max');
    await handle.setControl!('speed', 'fast');
    await handle.setControl!('speed', 'standard');
    expect(fake.q.setMaxThinkingTokens.mock.calls).toEqual([[THINKING_LEVEL_TOKENS.low, 'summarized'], [0, undefined]]);
    expect(fake.q.applyFlagSettings.mock.calls).toEqual([[{ effortLevel: 'max' }], [{ fastMode: true }], [{ fastMode: false }]]);
    await expect(handle.setControl!('temperature', 'hot')).rejects.toThrow('Unknown control "temperature" for Claude Code');
  });
});
