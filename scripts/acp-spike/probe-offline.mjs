/**
 * Offline ACP spike: drives `opencode acp` against a local fake of
 * OpenRouter's chat completions API, so every check runs without a network
 * or a key. Each PASS means OpenCode still behaves the way
 * docs/open-model-harnesses-plan.md ("Spike findings") assumes.
 *
 * Usage: cd scripts/acp-spike && npm install && node probe-offline.mjs [--save-fixtures]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { makeHome, isolatedEnv, groveConfig, startAgent, handshake, withTimeout, attempt, reporter, freePort, trimRecording } from './lib.mjs';
import { startFake } from './fake-openrouter.mjs';

const MODEL = 'deepseek/deepseek-v4.1-flash';
const KEY = 'fake-openrouter-key-for-spike';
const SAVE = process.argv.includes('--save-fixtures');
const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-rec-'));
const report = reporter();

// ─── Fake backend: replies from `steps`, one per tool result in this turn ───
let steps = [{ text: 'ok' }];
let failWith = null;
const fake = await startFake({
  logFile: path.join(rec, 'backend.jsonl'),
  script: (body) => {
    if (!body.tools?.length) return { text: 'Spike title' };
    if (failWith) return failWith;
    const lastUser = body.messages.findLastIndex((m) => m.role === 'user');
    const done = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    return steps[Math.min(done, steps.length - 1)];
  },
});
const backend = () => fake.requests;

function boot(name, { port, extraEnv = {}, onPermission } = {}) {
  const home = makeHome(name);
  const updates = [];
  const perms = [];
  const agent = startAgent({
    cwd: home.work,
    port,
    env: isolatedEnv(home, {
      OPENROUTER_API_KEY: KEY,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(groveConfig({ model: MODEL, baseURL: fake.url })),
      ...extraEnv,
    }),
    logFile: path.join(rec, `${name}.jsonl`),
    handlers: {
      sessionUpdate: async (n) => { updates.push(n.update); },
      requestPermission: async (p) => {
        perms.push(p);
        const kind = onPermission ? await onPermission(p) : 'allow_once';
        if (kind === 'cancelled') return { outcome: { outcome: 'cancelled' } };
        return { outcome: { outcome: 'selected', optionId: p.options.find((o) => o.kind === kind).optionId } };
      },
    },
  });
  return { ...agent, home, updates, perms };
}

const prompt = (a, sessionId, text, ms = 60000) => withTimeout(a.conn.prompt({ sessionId, prompt: [{ type: 'text', text }] }), ms, text);

try {
  // ─── A. Handshake, capabilities, controls ───
  const A = boot('handshake');
  let sidA;
  try {
    const { init, session } = await handshake(A.conn, A.home.work);
    sidA = session.sessionId;
    const caps = init.agentCapabilities;
    report.note('agent', `${init.agentInfo?.name} ${init.agentInfo?.version}`);
    report.check('loadSession + resume + fork + list + close advertised', caps.loadSession && ['resume', 'fork', 'list', 'close'].every((k) => caps.sessionCapabilities?.[k]));
    report.check('HTTP MCP servers supported', caps.mcpCapabilities?.http === true);
    report.check('image prompts supported', caps.promptCapabilities?.image === true);
    const cfg = Object.fromEntries(session.configOptions.map((o) => [o.category, o]));
    report.check('config options: model, thought_level, mode', !!(cfg.model && cfg.thought_level && cfg.mode));
    report.check('model set from OPENCODE_CONFIG_CONTENT', cfg.model?.currentValue === `openrouter/${MODEL}`, cfg.model?.currentValue);
    report.note('model list size', String(cfg.model?.options.length));
    report.note('modes', cfg.mode?.options.map((o) => o.value).join(', '));
    report.note('effort for Flash', cfg.thought_level?.options.map((o) => o.value).join(', '));
    const sw = await attempt(() => A.conn.setSessionConfigOption({ sessionId: sidA, configId: 'model', value: 'openrouter/deepseek/deepseek-v4-pro' }));
    const after = sw.value?.configOptions;
    report.check('live model switch', after?.find((o) => o.id === 'model')?.currentValue === 'openrouter/deepseek/deepseek-v4-pro');
    report.note('effort for Pro', after?.find((o) => o.category === 'thought_level')?.options.map((o) => o.value).join(', ') ?? '-');
    const bad = await attempt(() => A.conn.setSessionConfigOption({ sessionId: sidA, configId: 'model', value: 'openrouter/not/a-model' }));
    report.check('unknown model rejected with -32602', !bad.ok && bad.error?.code === -32602);
    await new Promise((r) => setTimeout(r, 500));
    const cmds = A.updates.find((u) => u.sessionUpdate === 'available_commands_update');
    report.note('slash commands', cmds?.availableCommands.map((c) => c.name).join(', ') ?? 'none');
  } finally { await A.close(); }

  // ─── B. Tool turn: todowrite, write (once), edit (always), bash (reject) ───
  const answers = [];
  let release = null;
  const B = boot('turns', {
    onPermission: async () => {
      const a = answers.shift() ?? 'allow_once';
      return a === 'hang' ? new Promise((res) => { release = () => res('cancelled'); }) : a;
    },
  });
  let sidB;
  try {
    ({ session: { sessionId: sidB } } = await handshake(B.conn, B.home.work));
    const file = path.join(B.home.work, 'hello.txt');
    steps = [
      { reasoning: 'Plan first.', toolCalls: [{ name: 'todowrite', args: { todos: [{ content: 'Create hello.txt', status: 'in_progress', priority: 'high' }, { content: 'Edit it', status: 'pending', priority: 'medium' }] } }] },
      { text: 'Creating the file.', toolCalls: [{ name: 'write', args: { filePath: file, content: 'hello\nworld\n' } }] },
      { toolCalls: [{ name: 'edit', args: { filePath: file, oldString: 'world', newString: 'grove' } }] },
      { toolCalls: [{ name: 'bash', args: { command: 'echo hi', description: 'Say hi' } }] },
      { text: 'All done.' },
    ];
    answers.push('allow_once', 'allow_always', 'reject_once');
    const before = backend().length;
    const r = await prompt(B, sidB, 'Make hello.txt, edit it, then say hi.');
    const u = B.updates;
    report.check('turn ends with end_turn + usage', r.stopReason === 'end_turn' && !!r.usage);
    report.check('permission kinds: edit, edit, execute', B.perms.map((p) => p.toolCall.kind).join() === 'edit,edit,execute', B.perms.map((p) => p.toolCall.kind).join());
    report.check('permission options: once / always / reject', B.perms[0].options.map((o) => o.kind).join() === 'allow_once,allow_always,reject_once');
    const writeDiff = B.perms[0].toolCall.content?.find((c) => c.type === 'diff');
    report.check('write permission carries a diff (oldText "", newText)', writeDiff?.oldText === '' && writeDiff?.newText === 'hello\nworld\n');
    const firstCall = u.find((x) => x.sessionUpdate === 'tool_call');
    report.check('tool_call starts with empty rawInput (input arrives in_progress)', firstCall && Object.keys(firstCall.rawInput ?? {}).length === 0);
    const todo = u.find((x) => x.sessionUpdate === 'tool_call_update' && x.rawInput?.todos);
    report.check('to-dos come as a todowrite tool call, not a plan update', !!todo && !u.some((x) => x.sessionUpdate === 'plan'));
    const editDone = u.find((x) => x.sessionUpdate === 'tool_call_update' && x.status === 'completed' && x.content?.some((c) => c.type === 'diff'));
    report.check('completed edit carries a diff', editDone?.content.find((c) => c.type === 'diff')?.newText === 'grove');
    const rejected = u.find((x) => x.sessionUpdate === 'tool_call_update' && x.status === 'failed');
    report.check('rejected command shows as failed tool call', rejected?.kind === 'execute');
    report.check('rejecting ends the turn (no further model call)', backend().slice(before).filter((q) => q.body.tools?.length).length === 4);
    report.check('file written and edited', fs.readFileSync(file, 'utf8') === 'hello\ngrove\n');
    const usage = u.find((x) => x.sessionUpdate === 'usage_update');
    report.check('usage_update has context size and USD cost', usage?.size === 1048576 && usage?.cost?.currency === 'USD', `size=${usage?.size}`);
    report.check('message chunks carry messageId', u.find((x) => x.sessionUpdate === 'agent_message_chunk')?.messageId?.length > 0);
    const req = backend().findLast((q) => q.body.tools?.length);
    report.check('key reaches OpenRouter via {env:...}', req.auth === `Bearer ${KEY}`);
    report.note('tools offered', req.body.tools.map((t) => t.function.name).join(', '));
    report.note('extra requests per turn', `${backend().slice(before).filter((q) => !q.body.tools?.length).length} without tools (title generation)`);

    // C. allow_always sticks for the next turn
    const n = B.perms.length;
    steps = [{ toolCalls: [{ name: 'edit', args: { filePath: file, oldString: 'grove', newString: 'bench' } }] }, { text: 'ok' }];
    await prompt(B, sidB, 'Edit it again.');
    report.check('always-allow skips the next edit prompt', B.perms.length === n && fs.readFileSync(file, 'utf8') === 'hello\nbench\n');

    // D. Stop while a permission prompt is open
    steps = [{ toolCalls: [{ name: 'bash', args: { command: 'echo hi', description: 'hi' } }] }, { text: 'ok' }];
    answers.push('hang');
    const pending = B.conn.prompt({ sessionId: sidB, prompt: [{ type: 'text', text: 'say hi' }] });
    await withTimeout((async () => { while (!release) await new Promise((r) => setTimeout(r, 50)); })(), 30000, 'wait for permission');
    await B.conn.cancel({ sessionId: sidB });
    release(); // ACP: the client answers a pending permission request with "cancelled"
    const stopped = await withTimeout(pending, 30000, 'cancel');
    report.check('cancel during a permission prompt -> stopReason cancelled', stopped.stopReason === 'cancelled');

    // E. Plan mode with agent.plan.permission.edit = deny
    await B.conn.setSessionConfigOption({ sessionId: sidB, configId: 'mode', value: 'plan' });
    steps = [{ toolCalls: [{ name: 'edit', args: { filePath: file, oldString: 'bench', newString: 'nope' } }] }, { text: 'ok' }];
    await prompt(B, sidB, 'Plan it.');
    const planTools = backend().findLast((q) => q.body.tools?.length).body.tools.map((t) => t.function.name);
    report.check('plan mode removes edit and write tools', !planTools.includes('edit') && !planTools.includes('write'), planTools.join(','));
    report.check('plan mode leaves the file alone', fs.readFileSync(file, 'utf8') === 'hello\nbench\n');
    await B.conn.setSessionConfigOption({ sessionId: sidB, configId: 'mode', value: 'build' });

    // F. Provider error
    failWith = { status: 401, error: { code: 401, message: 'User not found.' } };
    const err = await attempt(() => prompt(B, sidB, 'Anything.'));
    failWith = null;
    report.check('provider 401 -> prompt error -32603 with provider message', !err.ok && err.error?.code === -32603, err.error?.message);
  } finally { await B.close(); }

  // ─── G. Restart: load replays history, resume doesn't ───
  // Same home as B, so OpenCode finds the session in its database.
  const G2 = (() => {
    const updates = [];
    const agent = startAgent({
      cwd: B.home.work,
      env: isolatedEnv(B.home, { OPENROUTER_API_KEY: KEY, OPENCODE_CONFIG_CONTENT: JSON.stringify(groveConfig({ model: MODEL, baseURL: fake.url })) }),
      logFile: path.join(rec, 'reload.jsonl'),
      handlers: { sessionUpdate: async (n) => { updates.push(n.update); } },
    });
    return { ...agent, updates };
  })();
  try {
    await G2.conn.initialize({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'spike', version: '0' } });
    await G2.conn.loadSession({ sessionId: sidB, cwd: B.home.work, mcpServers: [] });
    await new Promise((r) => setTimeout(r, 800));
    const replayed = G2.updates.filter((u) => u.sessionUpdate === 'user_message_chunk').length;
    report.check('session/load after restart replays the conversation', replayed >= 3, `${replayed} user messages`);
    G2.updates.length = 0;
    await G2.conn.resumeSession({ sessionId: sidB, cwd: B.home.work, mcpServers: [] });
    await new Promise((r) => setTimeout(r, 500));
    report.check('session/resume does not replay', !G2.updates.some((u) => u.sessionUpdate === 'user_message_chunk'));
    const fork = await attempt(() => G2.conn.unstable_forkSession({ sessionId: sidB, cwd: B.home.work, mcpServers: [] }));
    report.check('fork works (whole session only, no message id)', fork.ok && !!fork.value.sessionId);
  } finally { await G2.close(); }

  // ─── H. The HTTP server `opencode acp` opens ───
  for (const withPassword of [false, true]) {
    const port = await freePort();
    const H = boot(withPassword ? 'server-pw' : 'server-open', { port, extraEnv: withPassword ? { OPENCODE_SERVER_PASSWORD: 'spike-secret' } : {} });
    try {
      await handshake(H.conn, H.home.work);
      const res = await fetch(`http://127.0.0.1:${port}/config`);
      const body = await res.text();
      if (withPassword) {
        report.check('OPENCODE_SERVER_PASSWORD locks the server (401)', res.status === 401);
        const ok = await fetch(`http://127.0.0.1:${port}/config`, { headers: { Authorization: 'Basic ' + Buffer.from('opencode:spike-secret').toString('base64') } });
        report.check('basic auth opencode:<password> gets in', ok.status === 200);
      } else {
        report.note('server without a password', `GET /config -> ${res.status}, contains API key: ${body.includes(KEY)}`);
        const create = await fetch(`http://127.0.0.1:${port}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        report.note('server without a password', `POST /session -> ${create.status}`);
      }
    } finally { await H.close(); }
  }

  // ─── I. Grove memory tools over HTTP MCP ───
  const TOKEN = 'spike-mcp-token';
  let authed = 0;
  const mcp = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
    authed++;
    let raw = '';
    for await (const c of req) raw += c;
    const server = new McpServer({ name: 'grove-memory', version: '0.0.0' });
    server.tool('memory_read', 'Read a memory file', { path: z.string() }, async ({ path: p }) => ({ content: [{ type: 'text', text: `contents of ${p}` }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  await new Promise((r) => mcp.listen(0, '127.0.0.1', r));
  const I = boot('mcp');
  try {
    const url = `http://127.0.0.1:${mcp.address().port}/mcp`;
    const { session } = await handshake(I.conn, I.home.work, [{ type: 'http', name: 'grove-memory', url, headers: [{ name: 'Authorization', value: `Bearer ${TOKEN}` }] }]);
    steps = [{ toolCalls: [{ name: 'grove-memory_memory_read', args: { path: 'repo/overview.md' } }] }, { text: 'ok' }];
    await prompt(I, session.sessionId, 'Read memory.');
    const names = backend().findLast((q) => q.body.tools?.length).body.tools.map((t) => t.function.name);
    report.check('MCP tool reaches the model as grove-memory_memory_read', names.includes('grove-memory_memory_read'));
    const done = I.updates.find((u) => u.sessionUpdate === 'tool_call_update' && u.status === 'completed');
    report.check('MCP call returns content with the bearer token', authed > 0 && done?.content?.[0]?.content?.text === 'contents of repo/overview.md');
    report.check('MCP tools do not ask permission', I.perms.length === 0);
  } finally { await I.close(); mcp.close(); }

  if (SAVE) {
    const out = path.join(import.meta.dirname, 'fixtures');
    for (const name of ['handshake', 'turns', 'reload', 'mcp']) {
      const src = path.join(rec, `${name}.jsonl`);
      if (fs.existsSync(src)) trimRecording(src, path.join(out, `${name}.jsonl`), path.dirname(B.home.root));
    }
    console.log(`\nSaved trimmed recordings to ${out}`);
  }
} finally {
  fake.close();
}
process.exitCode = report.summary() ? 1 : 0;
