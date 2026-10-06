// A minimal ACP agent for acp-adapter.test.ts. It speaks newline-delimited
// JSON-RPC on stdio like a real agent. FAKE_ACP_SCENARIO picks behaviour:
//   default  - normal session with modes and a model config option
//   auth     - session/new answers auth_required
//   keyauth  - like Gemini CLI set to a retired sign-in: session/new is
//              turned down until authenticate brings the key 'good-key'
//   nohttp   - no HTTP MCP support
//   media    - takes audio and embedded resources in prompts too
//   noimage  - takes nothing beyond the baseline (no images)
// Prompt texts pick a turn: 'wait', 'titled-exec', 'env', 'unasked', 'unasked-read',
// 'echo', 'blocks', 'mcp', 'mcp-call', 'self-mode', 'cost'; anything else runs the default turn.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import path from 'node:path';

const scenario = process.env.FAKE_ACP_SCENARIO || 'default';
let nextId = 1000;
const waiting = new Map();
let cancelRequested = null;
let model = 'm1';
let lastMcpServers = [];
let busy = false;
let spent = 0;
let keySignedIn = false;

function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
}
function update(sessionId, u) {
  send({ method: 'session/update', params: { sessionId, update: u } });
}
function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve) => waiting.set(id, resolve));
}
function configOptions() {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
      options: [{ value: 'm1', name: 'Model 1' }, { value: 'm2', name: 'Model 2' }] },
    { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'low',
      options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  ];
}
const modes = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }] };

/** Start a stdio MCP server the client gave us, as an agent would, and
 *  call one tool through it. Resolves with the tool's first text. */
function callStdioTool(server, name, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...Object.fromEntries((server.env ?? []).map((e) => [e.name, e.value])) };
    const child = spawn(server.command, server.args ?? [], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
    createInterface({ input: child.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
      } else if (msg.id === 2) {
        child.stdin.end();
        resolve(msg.error ? `error: ${msg.error.message}` : msg.result.content[0].text);
      }
    });
    child.on('error', reject);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } } });
  });
}

async function prompt(params) {
  const sid = params.sessionId;
  const text = params.prompt.find((b) => b.type === 'text')?.text ?? '';
  const cwd = process.cwd();
  if (text === 'wait') {
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' } });
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'slow', kind: 'execute', title: 'Sleep', status: 'in_progress', rawInput: { command: 'sleep 100' } });
    await new Promise((resolve) => { cancelRequested = resolve; });
    return { stopReason: 'cancelled' };
  }
  if (text === 'env' || text.endsWith('\n\nenv')) {
    // What the adapter put in this process's environment.
    const env = { key: process.env.FAKE_KEY_VAR ?? null, spawn: process.env.FAKE_SPAWN ?? null };
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(env) } });
    return { stopReason: 'end_turn' };
  }
  if (text === 'unasked') {
    // Like OpenCode with its default permissions: edits and runs commands
    // without asking the client first.
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'u1', kind: 'edit', title: 'write', status: 'pending', rawInput: {} });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'u1', status: 'in_progress', locations: [{ path: path.join(cwd, 'b.txt') }], rawInput: { filePath: path.join(cwd, 'b.txt'), content: 'x' } });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'u1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Wrote file' } }] });
    for (const id of ['u2', 'u3']) {
      update(sid, { sessionUpdate: 'tool_call', toolCallId: id, kind: 'execute', title: 'rm -rf build', status: 'pending', rawInput: { command: 'rm -rf build' } });
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '' } }] });
    }
    return { stopReason: 'end_turn' };
  }
  if (text === 'cost') {
    // Like OpenCode: usage_update carries the session's running cost, and the
    // answer the turn's token counts.
    spent += 0.01;
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Paid' } });
    update(sid, { sessionUpdate: 'usage_update', used: 900, size: 100000, cost: { amount: spent, currency: 'USD' } });
    return { stopReason: 'end_turn', usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 } };
  }
  if (text === 'self-mode') {
    // Like Gemini CLI leaving plan mode by itself: the agent switches its own
    // mode and effort, then answers.
    modes.currentModeId = 'yolo';
    update(sid, { sessionUpdate: 'current_mode_update', currentModeId: 'yolo' });
    update(sid, { sessionUpdate: 'config_option_update', configOptions: configOptions().map((o) => o.id === 'effort' ? { ...o, currentValue: 'high' } : o) });
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Switched' } });
    return { stopReason: 'end_turn' };
  }
  if (text === 'unasked-read') {
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'r1', kind: 'execute', title: 'git status', status: 'pending', rawInput: { command: 'git status' } });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'clean' } }] });
    return { stopReason: 'end_turn' };
  }
  if (text === 'titled-exec') {
    // Like Gemini CLI: a title, no rawInput.
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'e1', kind: 'execute', title: 'npm test', status: 'pending' });
    const answer = await request('session/request_permission', {
      sessionId: sid, toolCall: { toolCallId: 'e1' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
    });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: answer.outcome.optionId === 'ok' ? 'completed' : 'failed' });
    return { stopReason: 'end_turn' };
  }
  if (text === 'blocks') {
    // Every block after the text, as JSON, so a test can see what was sent.
    const rest = params.prompt.slice(params.prompt.findIndex((b) => b.type === 'text') + 1);
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(rest) } });
    return { stopReason: 'end_turn' };
  }
  if (params.prompt.at(-1)?.text === 'echo') {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const texts = params.prompt.filter((b) => b.type === 'text').map((b) => b.text).join('|');
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: texts } });
    return { stopReason: 'end_turn' };
  }
  if (text === 'mcp-call') {
    const server = lastMcpServers.find((s) => s.name === 'grove-memory');
    const result = server ? await callStdioTool(server, 'memory_read', { path: 'repo/overview.md' }) : 'no server';
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result } });
    return { stopReason: 'end_turn' };
  }
  if (text === 'mcp') {
    const summary = lastMcpServers.map((s) => s.command
      ? { type: 'stdio', name: s.name, env: (s.env ?? []).map((e) => e.name) }
      : { type: s.type, name: s.name, auth: !!s.headers?.length });
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(summary) } });
    return { stopReason: 'end_turn' };
  }
  if (text.startsWith('You write commit messages')) {
    const answer = await request('session/request_permission', {
      sessionId: sid, toolCall: { toolCallId: 'x', kind: 'read', title: 'Read' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
    });
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Fix the thing (${answer.outcome.optionId}, ${model})` } });
    return { stopReason: 'end_turn' };
  }
  update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking it over' } });
  update(sid, { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'Hello ' } });
  update(sid, { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'world' } });
  update(sid, { sessionUpdate: 'plan', entries: [{ content: 'Write a.txt', status: 'in_progress', priority: 'high' }] });
  update(sid, { sessionUpdate: 'tool_call', toolCallId: 't1', name: 'write_file', kind: 'edit', status: 'pending', title: 'Write a.txt',
    locations: [{ path: path.join(cwd, 'a.txt') }], rawInput: { path: 'a.txt', content: 'hi' } });
  const answer = await request('session/request_permission', {
    sessionId: sid,
    toolCall: { toolCallId: 't1', content: [{ type: 'diff', path: path.join(cwd, 'a.txt'), oldText: null, newText: 'hi' }] },
    options: [
      { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
  });
  const allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId.startsWith('allow');
  update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed',
    content: allowed ? [{ type: 'diff', path: path.join(cwd, 'a.txt'), oldText: null, newText: 'hi' }] : [{ type: 'content', content: { type: 'text', text: 'Rejected' } }] });
  update(sid, { sessionUpdate: 'plan', entries: [{ content: 'Write a.txt', status: 'completed', priority: 'high' }] });
  update(sid, { sessionUpdate: 'usage_update', used: 1200, size: 100000 });
  update(sid, { sessionUpdate: 'session_info_update', title: 'Writing a file' });
  return { stopReason: 'end_turn' };
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ id, result });
  const fail = (code, message) => send({ id, error: { code, message } });
  switch (method) {
    case 'initialize':
      // As strict as OpenCode: the protocol's Implementation type requires
      // clientInfo.name and clientInfo.version.
      if (typeof params?.protocolVersion !== 'number' || typeof params?.clientInfo?.name !== 'string' || typeof params?.clientInfo?.version !== 'string') {
        return fail(-32602, 'Invalid params');
      }
      return reply({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: scenario === 'media' ? { image: true, audio: true, embeddedContext: true }
            : scenario === 'noimage' ? {} : { image: true },
          mcpCapabilities: { http: scenario !== 'nohttp' },
        },
        agentInfo: { name: 'fake', version: '1' },
        authMethods: scenario === 'keyauth' ? [{ id: 'fake-api-key', name: 'API key' }] : [],
      });
    case 'authenticate':
      if (params?.methodId !== 'fake-api-key' || params?._meta?.['api-key'] !== 'good-key') return fail(-32000, 'Bad key');
      keySignedIn = true;
      return reply({});
    case 'session/new':
      if (scenario === 'auth') return fail(-32000, 'Authentication required');
      if (scenario === 'keyauth' && !keySignedIn) return fail(-32000, 'This client is no longer supported');
      lastMcpServers = params.mcpServers ?? [];
      setTimeout(() => update('s1', { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compress', description: 'Compress' }] }), 0);
      return reply({ sessionId: 's1', modes, configOptions: configOptions() });
    case 'session/load':
      lastMcpServers = params.mcpServers ?? [];
      update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old question' } });
      update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } });
      // A command from the old conversation, run without asking.
      update(params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'old1', kind: 'execute', title: 'rm -rf old', status: 'completed', rawInput: { command: 'rm -rf old' } });
      return reply({ modes, configOptions: configOptions() });
    case 'session/set_config_option':
      if (params.configId === 'model') model = params.value;
      return reply({ configOptions: configOptions() });
    case 'session/set_mode':
      return reply({});
    case 'session/prompt': {
      // ACP allows one prompt at a time per session.
      if (busy) return fail(-32603, 'A prompt is already running');
      busy = true;
      try {
        return reply(await prompt(params));
      } finally {
        busy = false;
      }
    }
    default:
      return fail(-32601, `Unknown method ${method}`);
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'session/cancel') {
    cancelRequested?.();
    return;
  }
  if (msg.method) {
    void handle(msg);
  } else if (waiting.has(msg.id)) {
    waiting.get(msg.id)(msg.result);
    waiting.delete(msg.id);
  }
});
