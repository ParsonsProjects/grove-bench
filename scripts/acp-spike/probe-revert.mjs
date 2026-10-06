/**
 * Can Grove rewind an OpenCode thread for real? ACP has no way to make an
 * agent forget turns, but `opencode acp` also runs OpenCode's HTTP server,
 * which has POST /session/:id/revert. This checks, against the local fake of
 * OpenRouter, whether reverting there while the ACP connection stays open
 * makes the model forget the turns, which message a revert removes, what it
 * does to files, and how Grove could find OpenCode's id for a message.
 *
 *   node probe-revert.mjs           # the work folder is a git repository, as a Grove worktree is
 *   node probe-revert.mjs --no-git  # a plain folder
 *   node probe-revert.mjs --restart # a new OpenCode process resumes the session after the revert, as Grove's rewind restarts the agent
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { makeHome, isolatedEnv, groveConfig, startAgent, handshake, withTimeout, reporter, freePort } from './lib.mjs';
import { startFake } from './fake-openrouter.mjs';

const MODEL = 'deepseek/deepseek-v4.1-flash';
const KEY = 'fake-openrouter-key-for-spike';
const PASSWORD = 'spike-secret';
const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-revert-'));
const report = reporter();

const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''));
let fileB = '';
const fake = await startFake({
  logFile: path.join(rec, 'backend.jsonl'),
  script: (body) => {
    if (!body.tools?.length) return { text: 'Spike title' };
    const lastUser = body.messages.findLastIndex((m) => m.role === 'user');
    const asked = textOf(body.messages[lastUser]);
    const toolsDone = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    if (asked.includes('Turn two') && toolsDone === 0) return { toolCalls: [{ name: 'write', args: { filePath: fileB, content: 'two\n' } }] };
    return { text: `ack: ${asked.slice(0, 24)}` };
  },
});

const GIT = !process.argv.includes('--no-git');
const RESTART = process.argv.includes('--restart');
const home = makeHome('revert');
fileB = path.join(home.work, 'b.txt');
if (GIT) {
  const git = (...args) => execFileSync('git', args, { cwd: home.work, env: { ...process.env, GIT_AUTHOR_NAME: 'spike', GIT_AUTHOR_EMAIL: 's@x', GIT_COMMITTER_NAME: 'spike', GIT_COMMITTER_EMAIL: 's@x' } });
  git('init', '-q');
  fs.writeFileSync(path.join(home.work, 'README.md'), 'spike\n');
  git('add', '.');
  git('commit', '-qm', 'start');
}
let port = await freePort();
const updates = [];
const boot = () => startAgent({
  cwd: home.work,
  port,
  env: isolatedEnv(home, {
    OPENROUTER_API_KEY: KEY,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(groveConfig({ model: MODEL, baseURL: fake.url })),
    OPENCODE_SERVER_PASSWORD: PASSWORD,
  }),
  logFile: path.join(rec, 'acp.jsonl'),
  handlers: {
    sessionUpdate: async (n) => { updates.push(n.update); },
    requestPermission: async (p) => ({ outcome: { outcome: 'selected', optionId: p.options.find((o) => o.kind === 'allow_once').optionId } }),
  },
});
let agent = boot();

const auth = { Authorization: 'Basic ' + Buffer.from(`opencode:${PASSWORD}`).toString('base64') };
async function api(method, route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
/** The session's messages as OpenCode stores them: role, id, text. */
async function messages(sid) {
  const { status, json } = await api('GET', `/session/${sid}/message`);
  if (status !== 200 || !Array.isArray(json)) throw new Error(`GET messages -> ${status}`);
  return json.map((m) => ({
    id: m.info?.id,
    role: m.info?.role,
    text: (m.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('').slice(0, 40),
  }));
}
const prompt = (sid, text) => withTimeout(agent.conn.prompt({ sessionId: sid, prompt: [{ type: 'text', text }] }), 60000, text);
/** User texts in the last request the model got for a real turn (with tools). */
function lastTurnUserTexts() {
  const turn = fake.requests.filter((r) => r.body.tools?.length).at(-1);
  return turn.body.messages.filter((m) => m.role === 'user').map(textOf);
}

try {
  const { init, session } = await handshake(agent.conn, home.work);
  const sid = session.sessionId;
  report.note('agent', `${init.agentInfo?.name} ${init.agentInfo?.version}, work folder ${GIT ? 'is' : 'is not'} a git repository${RESTART ? ', restarted after the revert' : ''}`);

  await prompt(sid, 'Turn one: remember APPLE.');
  await prompt(sid, 'Turn two: write b.txt.');
  await prompt(sid, 'Turn three: remember CHERRY.');
  report.check('turn two wrote b.txt', fs.existsSync(fileB));

  // ── Finding OpenCode's ids ──
  const liveUserIds = updates.filter((u) => u.sessionUpdate === 'user_message_chunk').map((u) => u.messageId);
  report.check('live ACP turns carry no user message ids', liveUserIds.length === 0, `${liveUserIds.length} seen`);
  const before = await messages(sid);
  report.check('ACP session id is the HTTP session id', before.length > 0, `${before.length} messages`);
  const users = before.filter((m) => m.role === 'user');
  report.note('user messages', users.map((m) => `${m.id} "${m.text}"`).join(' | '));
  const liveAgentIds = new Set(updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.messageId));
  const assistantIds = before.filter((m) => m.role === 'assistant').map((m) => m.id);
  report.check('ACP agent message ids are OpenCode message ids', [...liveAgentIds].every((id) => assistantIds.includes(id)), `${liveAgentIds.size} ids`);
  const target = users.find((m) => m.text.startsWith('Turn two'));
  report.check('the user message to rewind to can be found by its text', !!target);

  // ── Revert to turn two through the HTTP API, ACP connection still open ──
  const reverted = await api('POST', `/session/${sid}/revert`, { messageID: target.id });
  report.check('POST /session/:id/revert answers 200', reverted.status === 200, `${reverted.status} ${reverted.text.slice(0, 80)}`);
  const afterRevert = await messages(sid);
  report.note('messages right after revert', `${afterRevert.length} (was ${before.length}): deleted later, on the next prompt, or now`);
  report.note('files after revert', fs.existsSync(fileB) ? 'b.txt still there: OpenCode left the files alone' : 'b.txt gone: OpenCode restored the files too');

  if (RESTART) {
    await agent.close();
    port = await freePort();
    agent = boot();
    await agent.conn.initialize({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'spike', version: '0' } });
    await agent.conn.resumeSession({ sessionId: sid, cwd: home.work, mcpServers: [] });
  }

  // ── The next turn, over the same ACP connection (or the resumed one) ──
  const r = await prompt(sid, 'Turn four: what do you remember?');
  report.check('next ACP prompt works after the revert', r.stopReason === 'end_turn', r.stopReason);
  const sent = lastTurnUserTexts();
  report.note('user messages the model got for turn four', sent.map((t) => `"${t.slice(0, 30)}"`).join(', '));
  report.check('model still gets turn one', sent.some((t) => t.includes('Turn one')));
  report.check('model no longer gets turn three', !sent.some((t) => t.includes('Turn three')));
  report.check('revert removes the target message itself (turn two gone too)', !sent.some((t) => t.includes('Turn two')));
  const afterTurn = await messages(sid);
  report.note('stored messages after turn four', afterTurn.map((m) => `${m.role}:"${m.text.slice(0, 20)}"`).join(', '));
  report.check('reverted messages deleted from storage', !afterTurn.some((m) => m.text.startsWith('Turn two') || m.text.startsWith('Turn three')));
} catch (e) {
  report.check('probe ran to the end', false, e.stack ?? String(e));
  console.log(agent.stderr.join('').slice(-1500));
} finally {
  await agent.close();
  fake.close();
}
const failed = report.summary();
console.log(`recordings in ${rec}`);
process.exit(failed ? 1 : 0);
