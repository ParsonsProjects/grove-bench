// A minimal ACP agent for acp-adapter.test.ts. It speaks newline-delimited
// JSON-RPC on stdio like a real agent. FAKE_ACP_SCENARIO picks behaviour:
//   default  - normal session with modes and a model config option
//   auth     - session/new answers auth_required
//   nohttp   - no HTTP MCP support
import { createInterface } from 'node:readline';
import path from 'node:path';

const scenario = process.env.FAKE_ACP_SCENARIO || 'default';
let nextId = 1000;
const waiting = new Map();
let cancelRequested = null;
let model = 'm1';
let lastMcpServers = [];

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
  if (params.prompt.at(-1)?.text === 'echo') {
    const texts = params.prompt.filter((b) => b.type === 'text').map((b) => b.text).join('|');
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: texts } });
    return { stopReason: 'end_turn' };
  }
  if (text === 'mcp') {
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(lastMcpServers.map((s) => ({ type: s.type, name: s.name, auth: !!s.headers?.length }))) } });
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
      return reply({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, mcpCapabilities: { http: scenario !== 'nohttp' } },
        agentInfo: { name: 'fake', version: '1' },
        authMethods: [],
      });
    case 'session/new':
      if (scenario === 'auth') return fail(-32000, 'Authentication required');
      lastMcpServers = params.mcpServers ?? [];
      setTimeout(() => update('s1', { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compress', description: 'Compress' }] }), 0);
      return reply({ sessionId: 's1', modes, configOptions: configOptions() });
    case 'session/load':
      lastMcpServers = params.mcpServers ?? [];
      update(params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old question' } });
      update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } });
      return reply({ modes, configOptions: configOptions() });
    case 'session/set_config_option':
      if (params.configId === 'model') model = params.value;
      return reply({ configOptions: configOptions() });
    case 'session/set_mode':
      return reply({});
    case 'session/prompt':
      return reply(await prompt(params));
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
