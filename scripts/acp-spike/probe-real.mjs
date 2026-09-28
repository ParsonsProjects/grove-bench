/**
 * Real ACP spike: runs one small coding task on DeepSeek V4.1 Flash through
 * OpenRouter with your own key, in a throwaway folder, then checks a wrong
 * key and the local server lock. Answers the Phase 0 questions the offline
 * probe can't: real model behaviour, the Windows shell, Windows paths, the
 * npm shim, time and cost.
 *
 * Usage (PowerShell):
 *   cd scripts\acp-spike; npm install
 *   $env:OPENROUTER_API_KEY = "sk-or-..."
 *   node probe-real.mjs            # uses the opencode that npm install fetched
 *   node probe-real.mjs --from-path  # uses the opencode on your PATH instead
 *
 * Safety: everything runs in a new temp folder with its own OpenCode home, so
 * your own OpenCode config, sign-ins and sessions are not read or changed.
 * Edits outside that folder are rejected, and only `node` / listing commands
 * are allowed to run. Expected cost: well under $0.01.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { makeHome, isolatedEnv, groveConfig, startAgent, handshake, withTimeout, attempt, reporter, freePort, trimRecording, resolveOpencode } from './lib.mjs';
import { startFake } from './fake-openrouter.mjs';

const MODEL = process.env.SPIKE_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const FAKE = process.argv.includes('--fake'); // dry run against the local fake, for testing this script
if (process.argv.includes('--from-path')) process.env.OPENCODE_FROM_PATH = '1';
const KEY = FAKE ? 'fake-key' : process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error('Set OPENROUTER_API_KEY first (see the comment at the top of this file).');
  process.exit(2);
}

const report = reporter();
const rec = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-real-rec-'));
const fake = FAKE ? await startFake({ logFile: path.join(rec, 'backend.jsonl'), script: fakeScript }) : null;
const baseURL = fake?.url;

report.note('platform', `${process.platform} ${os.release()} node ${process.version}`);
const bin = resolveOpencode();
report.note('opencode binary', bin);
report.check('binary is not a .cmd/.bat shim', !/\.(cmd|bat)$/i.test(bin));
report.note('opencode version', execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim());

// ─── A throwaway git repo with a tiny task ───
const home = makeHome('real');
const work = home.work;
fs.writeFileSync(path.join(work, 'math.js'), 'function sub(a, b) {\n  return a - b;\n}\n\nmodule.exports = { sub };\n');
fs.writeFileSync(path.join(work, 'README.md'), '# spike\n');
try { execFileSync('git', ['init', '-q'], { cwd: work }); } catch {}

const updates = [];
const perms = [];
const isInside = (p) => path.resolve(p).toLowerCase().startsWith(path.resolve(work).toLowerCase());
const SAFE_CMD = /^(node\s|ls\b|dir\b|type\s|cat\s|Get-ChildItem\b|Get-Content\b)/i;

const agent = startAgent({
  cwd: work,
  port: await freePort(),
  env: isolatedEnv(home, {
    OPENROUTER_API_KEY: KEY,
    OPENCODE_SERVER_PASSWORD: 'spike-' + Math.random().toString(36).slice(2),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(groveConfig({ model: MODEL, baseURL })),
  }),
  logFile: path.join(rec, 'real.jsonl'),
  handlers: {
    sessionUpdate: async (n) => { updates.push({ t: Date.now(), ...n.update }); },
    requestPermission: async (p) => {
      const tc = p.toolCall;
      const paths = [...(tc.locations ?? []).map((l) => l.path), ...(tc.content ?? []).filter((c) => c.type === 'diff').map((c) => c.path)];
      const cmd = tc.rawInput?.command ?? tc.title;
      let ok = tc.kind === 'execute' ? SAFE_CMD.test(String(cmd).trim()) : paths.every(isInside);
      perms.push({ kind: tc.kind, title: tc.title, paths, allowed: ok, hasDiff: (tc.content ?? []).some((c) => c.type === 'diff') });
      console.log(`  permission ${ok ? 'ALLOW' : 'REJECT'} ${tc.kind}: ${String(tc.title).slice(0, 100)}`);
      const want = ok ? 'allow_once' : 'reject_once';
      return { outcome: { outcome: 'selected', optionId: p.options.find((o) => o.kind === want).optionId } };
    },
  },
});

const TASK = 'Add an add(a, b) function to math.js and export it. Then create math.test.js that checks add(2, 3) === 5 and sub(5, 3) === 2 using node:assert, and run it with `node math.test.js`. Keep a short todo list while you work.';
try {
  const t0 = Date.now();
  const { init, session } = await handshake(agent.conn, work);
  report.note('handshake', `${Date.now() - t0} ms, session ${session.sessionId}`);
  report.check('model from config', session.configOptions.find((o) => o.id === 'model')?.currentValue === `openrouter/${MODEL}`);

  const t1 = Date.now();
  const r = await attempt(() => withTimeout(agent.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: TASK }] }), 300000, 'task'));
  const first = updates.find((u) => u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk' || u.sessionUpdate === 'tool_call');
  report.check('task finished', r.ok, r.ok ? r.value.stopReason : r.error?.message);
  report.note('time', `first update ${first ? first.t - t1 : '-'} ms, whole turn ${Date.now() - t1} ms`);
  const usage = updates.filter((u) => u.sessionUpdate === 'usage_update').at(-1);
  report.note('usage', `context used ${usage?.used} of ${usage?.size}, cost $${usage?.cost?.amount}`);
  // Completed updates don't repeat `kind` or `rawInput`, so remember them per call.
  const calls = new Map();
  for (const u of updates) {
    if (!u.toolCallId) continue;
    const c = calls.get(u.toolCallId) ?? {};
    calls.set(u.toolCallId, { ...c, kind: u.kind ?? c.kind, title: c.title ?? u.title, input: Object.keys(u.rawInput ?? {}).length ? u.rawInput : c.input, status: u.status ?? c.status, output: u.content ?? c.output });
  }
  const byTool = {};
  for (const c of calls.values()) byTool[`${c.kind}:${c.status}`] = (byTool[`${c.kind}:${c.status}`] ?? 0) + 1;
  report.note('tool calls', JSON.stringify(byTool));
  report.check('model kept a todo list (todowrite)', updates.some((u) => u.rawInput?.todos));
  report.note('plan updates (ACP plan)', String(updates.filter((u) => u.sessionUpdate === 'plan').length));
  report.check('every permission request carried locations or a command', perms.every((p) => p.paths.length || p.kind === 'execute'));
  report.check('no rejected permissions', perms.every((p) => p.allowed), perms.filter((p) => !p.allowed).map((p) => p.title).join(' | '));
  const loc = updates.flatMap((u) => u.locations ?? []).map((l) => l.path).find(Boolean);
  report.note('path format in locations', loc ?? '-');
  const shell = [...calls.values()].find((c) => c.kind === 'execute');
  report.note('shell command as sent', shell?.input?.command ?? '-');
  report.note('shell output', JSON.stringify(shell?.output?.[0]?.content?.text ?? '-').slice(0, 200));
  let testsPass = false;
  try { execFileSync(process.execPath, ['math.test.js'], { cwd: work, stdio: 'pipe' }); testsPass = true; } catch {}
  report.check('math.test.js exists and passes when we run it', testsPass);
  const files = fs.readdirSync(work).filter((f) => f !== '.git');
  report.note('files in work folder', files.join(', '));
  report.check('nothing written outside the work folder', fs.readdirSync(home.root).every((d) => ['home', 'config', 'data', 'cache', 'state', 'work'].includes(d)));
  report.note('text reply', updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content?.text ?? '').join('').slice(0, 300).replace(/\s+/g, ' '));

  // The local server must be locked by the password.
  const portArg = agent.child.spawnargs.indexOf('--port');
  const port = agent.child.spawnargs[portArg + 1];
  const res = await attempt(() => fetch(`http://127.0.0.1:${port}/config`));
  report.check('local server refuses requests without the password', res.ok && res.value.status === 401, res.ok ? String(res.value.status) : res.error?.message);

  // Where did OpenCode put its own files?
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '.git' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const own = walk(home.root).map((f) => path.relative(home.root, f)).filter((f) => !f.startsWith('work'));
  report.note('OpenCode files in isolated home', own.filter((f) => !f.includes(`snapshot${path.sep}`)).join(', '));
  report.note('OpenCode snapshot repo (its own undo history)', own.some((f) => f.includes(`snapshot${path.sep}`)) ? 'yes, under data/opencode/snapshot' : 'no');
} finally {
  await agent.close();
}

// ─── A wrong key: what does the user see? ───
const badHome = makeHome('badkey');
let badBackend = null;
const bad = startAgent({
  cwd: badHome.work,
  env: isolatedEnv(badHome, {
    // Well-formed but wrong. Built at run time so secret scanners don't flag it.
    OPENROUTER_API_KEY: 'sk-or-v1-' + '0'.repeat(64),
    OPENCODE_SERVER_PASSWORD: 'x',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(groveConfig({ model: MODEL, baseURL: FAKE ? await badFake() : undefined })),
  }),
  logFile: path.join(rec, 'badkey.jsonl'),
});
try {
  const { session } = await handshake(bad.conn, badHome.work);
  const e = await attempt(() => withTimeout(bad.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'hi' }] }), 60000, 'badkey'));
  report.check('wrong key fails the prompt (not a hang)', !e.ok && !String(e.error?.message).startsWith('timeout'));
  report.note('wrong key error', `${e.error?.code} ${e.error?.message} ${JSON.stringify(e.error?.data ?? {})}`);
} finally {
  await bad.close();
}

const out = path.join(import.meta.dirname, 'fixtures', `real-${process.platform}.jsonl`);
trimRecording(path.join(rec, 'real.jsonl'), out, path.dirname(home.root));
console.log(`\nSaved the recorded session (keys never appear in it) to ${out}`);
fake?.close();
badBackend?.close();
process.exitCode = report.summary() ? 1 : 0;

// ─── Dry-run helpers (--fake) ───
function fakeScript(body) {
  if (!body.tools?.length) return { text: 'Spike title' };
  const lastUser = body.messages.findLastIndex((m) => m.role === 'user');
  const done = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
  const steps = [
    { toolCalls: [{ name: 'todowrite', args: { todos: [{ content: 'add()', status: 'in_progress', priority: 'high' }, { content: 'test', status: 'pending', priority: 'medium' }] } }] },
    { toolCalls: [{ name: 'edit', args: { filePath: path.join(work, 'math.js'), oldString: 'module.exports = { sub };', newString: 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { sub, add };' } }] },
    { toolCalls: [{ name: 'write', args: { filePath: path.join(work, 'math.test.js'), content: "const assert = require('node:assert');\nconst { add, sub } = require('./math');\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(sub(5, 3), 2);\nconsole.log('ok');\n" } }] },
    { toolCalls: [{ name: 'bash', args: { command: 'node math.test.js', description: 'Run the test' } }] },
    { text: 'Added add() and a passing test.' },
  ];
  return steps[Math.min(done, steps.length - 1)];
}
async function badFake() {
  badBackend = await startFake({ logFile: path.join(rec, 'bad-backend.jsonl'), script: (b) => (b.tools?.length ? { status: 401, error: { code: 401, message: 'User not found.' } } : { text: 't' }) });
  return badBackend.url;
}
