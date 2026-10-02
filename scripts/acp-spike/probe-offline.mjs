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
    if (typeof failWith === 'function') { const r = failWith(body); if (r) return r; } else if (failWith) return failWith;
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
    report.check('no task tool, so no subagents', !req.body.tools.some((t) => t.function.name === 'task'));
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

  // ─── J. Out of credit, rate limits, errors mid-stream ───
  const J = boot('limits');
  try {
    const { session } = await handshake(J.conn, J.home.work);
    const sid = session.sessionId;
    const toolReqs = () => fake.requests.filter((q) => q.body.tools?.length).length;
    await prompt(J, sid, 'warm up'); // title request out of the way

    // 402: credits used up (https://openrouter.ai/docs/api_reference/limits)
    let before = toolReqs();
    failWith = { status: 402, error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits' } };
    const e402 = await attempt(() => prompt(J, sid, 'hi'));
    report.check('out of credit (402) fails the prompt with the message, no retry',
      !e402.ok && /Insufficient credits/.test(e402.error?.message) && toolReqs() - before === 1, `${e402.error?.code} ${e402.error?.message?.slice(0, 60)}; requests ${toolReqs() - before}`);

    // 429 once, then fine: does it retry on its own?
    before = toolReqs();
    let n429 = 0;
    failWith = () => (n429++ === 0 ? { status: 429, headers: { 'retry-after': '1' }, error: { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } } : null);
    steps = [{ text: 'after the rate limit' }];
    J.updates.length = 0;
    const t429 = Date.now();
    const once = await attempt(() => prompt(J, sid, 'hi again'));
    report.check('one 429 is retried and the turn succeeds', once.ok && once.value.stopReason === 'end_turn', `${toolReqs() - before} requests, ${Date.now() - t429} ms`);
    report.note('what the client sees during a retry', J.updates.map((u) => u.sessionUpdate).filter((k) => k !== 'agent_message_chunk').join(', ') || 'nothing but the reply');

    // 429 every time: does it give up, and does Stop work meanwhile?
    before = toolReqs();
    failWith = { status: 429, headers: { 'retry-after': '1' }, error: { code: 429, message: 'Rate limit exceeded' } };
    const tAlways = Date.now();
    const pending = J.conn.prompt({ sessionId: sid, prompt: [{ type: 'text', text: 'and again' }] });
    const always = await attempt(() => withTimeout(pending, 45000, '429 loop'));
    if (always.ok || !String(always.error?.message).startsWith('timeout')) {
      report.note('429 every time', `gave up after ${Date.now() - tAlways} ms and ${toolReqs() - before} requests: ${always.ok ? always.value.stopReason : always.error?.message}`);
    } else {
      report.note('429 every time', `still retrying after 45 s (${toolReqs() - before} requests)`);
      const tStop = Date.now();
      await J.conn.cancel({ sessionId: sid });
      const stopped = await attempt(() => withTimeout(pending, 15000, 'stop in 429 loop'));
      report.check('Stop works while it is retrying', stopped.ok && stopped.value.stopReason === 'cancelled', `${Date.now() - tStop} ms`);
    }
    failWith = null;

    // Error chunk after a 200 (upstream provider failed mid-stream): OpenCode
    // retries with a doubling backoff, re-streaming the partial text under the
    // same messageId, and tells the client nothing about the retry.
    steps = [{ text: 'partial answer', streamError: { code: 502, message: 'Provider disconnected' } }];
    J.updates.length = 0;
    let mark = fake.requests.length;
    const tMid = Date.now();
    const midP = J.conn.prompt({ sessionId: sid, prompt: [{ type: 'text', text: 'mid-stream' }] });
    const midReqs = () => fake.requests.slice(mark).filter((q) => q.body.tools?.length);
    await withTimeout((async () => { while (midReqs().length < 3) await new Promise((r) => setTimeout(r, 100)); })(), 30000, 'mid-stream retries');
    const gaps = midReqs().map((q, i, a) => (i ? q.at - a[i - 1].at : 0)).slice(1);
    report.check('error chunk mid-stream is retried with a growing delay', gaps.length >= 2 && gaps[1] > gaps[0], `gaps ${gaps.join(', ')} ms`);
    const chunks = J.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk');
    report.check('each retry re-sends the partial text under the same messageId', chunks.length >= 2 && new Set(chunks.map((c) => c.messageId)).size === 1, `${chunks.length} chunks`);
    report.check('no update tells the client it is retrying', J.updates.every((u) => ['agent_message_chunk', 'usage_update'].includes(u.sessionUpdate)), J.updates.map((u) => u.sessionUpdate).join(','));
    await J.conn.cancel({ sessionId: sid });
    const midEnd = await attempt(() => withTimeout(midP, 15000, 'stop during backoff'));
    report.check('Stop during the retry backoff ends the turn', midEnd.ok, midEnd.ok ? `stopReason ${midEnd.value.stopReason}, ${Date.now() - tMid} ms` : midEnd.error?.message);

    // The realistic case: a retry samples again, so its text differs. OpenCode
    // streams it into the same message after the failed attempt's text, with
    // no marker, so any ACP client shows both. An upstream bug; this check
    // flips when OpenCode fixes it.
    let tries = 0;
    failWith = () => (tries++ === 0
      ? { text: 'First attempt, partial', streamError: { code: 502, message: 'Provider disconnected' } }
      : { text: 'Second attempt, full answer.' });
    J.updates.length = 0;
    await prompt(J, sid, 'retry with new text');
    failWith = null;
    const shown = J.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content.text).join('');
    report.check('a retried reply is appended to the failed one (upstream OpenCode bug)', shown === 'First attempt, partialSecond attempt, full answer.', JSON.stringify(shown));

    // Stop aborts the HTTP request to the provider
    steps = [{ text: 'slow '.repeat(400), delayMs: 40 }];
    mark = fake.requests.length;
    const slow = J.conn.prompt({ sessionId: sid, prompt: [{ type: 'text', text: 'slow one' }] });
    await withTimeout((async () => { while (!fake.requests.slice(mark).some((q) => q.body.tools?.length)) await new Promise((r) => setTimeout(r, 50)); })(), 30000, 'slow start');
    await new Promise((r) => setTimeout(r, 300));
    await J.conn.cancel({ sessionId: sid });
    const slowEnd = await withTimeout(slow, 15000, 'slow stop');
    await new Promise((r) => setTimeout(r, 300));
    const slowReq = fake.requests.slice(mark).find((q) => q.body.tools?.length);
    report.check('Stop closes the request to the provider', slowEnd.stopReason === 'cancelled' && !!slowReq?.aborted);
  } finally { await J.close(); }

  // ─── K. A project's own opencode.json against Grove's settings ───
  // Grove's agent-level rules win over a project's top-level and agent-level
  // ones, except a rule a project puts after them: OpenCode lets the last
  // matching rule win, and a merged key keeps the project's position.
  const project = async (name, repoConfig) => {
    const K = boot(name);
    try {
      fs.writeFileSync(path.join(K.home.work, 'opencode.json'), JSON.stringify(repoConfig));
      const { session } = await handshake(K.conn, K.home.work);
      steps = [
        { toolCalls: [{ name: 'write', args: { filePath: path.join(K.home.work, 'a.txt'), content: 'a\n' } }] },
        { toolCalls: [{ name: 'bash', args: { command: 'echo hi', description: 'hi' } }] },
        { text: 'ok' },
      ];
      const mark = fake.requests.length;
      await prompt(K, session.sessionId, 'Write a.txt, then say hi.');
      const tools = fake.requests.slice(mark).find((q) => q.body.tools?.length).body.tools.map((t) => t.function.name);
      return { asked: K.perms.map((p) => p.toolCall.kind).join(), task: tools.includes('task') };
    } finally { await K.close(); }
  };
  const loose = await project('project-allow', {
    permission: { '*': 'allow', bash: 'allow', task: 'allow' },
    agent: { build: { permission: { edit: 'allow', bash: 'allow', task: 'allow' } } },
  });
  report.check('a project allowing everything still asks, and gets no task tool', loose.asked === 'edit,execute' && !loose.task, `asked ${loose.asked || 'nothing'}, task ${loose.task}`);
  const after = await project('project-allow-after', { agent: { build: { permission: { bash: 'allow', '*': 'allow' } } } });
  report.check('a project "*": "allow" after bash still skips the command prompt (known gap)', after.asked === 'edit', `asked ${after.asked || 'nothing'}`);

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
