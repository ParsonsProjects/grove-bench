/**
 * Shared helpers for the ACP spike: find the OpenCode binary, give each run an
 * isolated home, spawn `opencode acp`, and record every JSON-RPC line in both
 * directions. See README.md in this folder.
 */
import { spawn, execFileSync } from 'node:child_process';
import { Readable, Writable, PassThrough } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as acp from '@agentclientprotocol/sdk';

const HERE = import.meta.dirname;
const IS_WIN = process.platform === 'win32';

/** Resolve a spawnable OpenCode binary. Node refuses to spawn .cmd/.bat
 *  without a shell (CVE-2024-27980), so an npm shim on PATH is followed to the
 *  real opencode.exe that the opencode-ai package ships in its bin folder. */
export function resolveOpencode() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  const local = path.join(HERE, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  if (process.env.OPENCODE_FROM_PATH !== '1' && fs.existsSync(local)) return local;
  const found = IS_WIN
    ? execFileSync('where.exe', ['opencode'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
    : [execFileSync('which', ['opencode'], { encoding: 'utf8' }).trim()];
  const exe = found.find((p) => p.toLowerCase().endsWith('.exe'));
  if (exe) return exe;
  const shim = found.find((p) => /\.(cmd|bat)$/i.test(p));
  if (shim) {
    const beside = path.join(path.dirname(shim), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (fs.existsSync(beside)) return beside;
    throw new Error(`Only an npm shim was found (${shim}) and no opencode.exe beside it`);
  }
  return found[0];
}

export function makeHome(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `oc-${name}-`));
  const dirs = { root };
  for (const d of ['home', 'config', 'data', 'cache', 'state', 'work']) {
    dirs[d] = path.join(root, d);
    fs.mkdirSync(dirs[d], { recursive: true });
  }
  return dirs;
}

/** Minimal env for the agent: nothing from the user's own OpenCode setup. */
export function isolatedEnv(home, extra = {}) {
  const keep = ['PATH', 'HTTPS_PROXY', 'HTTP_PROXY', 'NODE_EXTRA_CA_CERTS'];
  if (IS_WIN) keep.push('SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'SystemDrive');
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  if (env.HTTPS_PROXY) env.NO_PROXY = '127.0.0.1,localhost';
  return {
    ...env,
    HOME: home.home,
    USERPROFILE: home.home,
    APPDATA: path.join(home.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home.home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: home.config,
    XDG_DATA_HOME: home.data,
    XDG_CACHE_HOME: home.cache,
    XDG_STATE_HOME: home.state,
    ...extra,
  };
}

/** Grove-style config: every risky tool asks, plan mode denies edits. */
export function groveConfig({ model, baseURL }) {
  return {
    model: `openrouter/${model}`,
    small_model: `openrouter/${model}`,
    permission: { edit: 'ask', bash: 'ask', webfetch: 'ask' },
    agent: { plan: { permission: { edit: 'deny' } } },
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}', ...(baseURL ? { baseURL } : {}) } } },
    autoupdate: false,
    share: 'disabled',
  };
}

export async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

/** Spawn `opencode acp` and connect. Returns { conn, child, stderr, close }. */
export function startAgent({ cwd, env, logFile, handlers = {}, port }) {
  const bin = resolveOpencode();
  const args = ['acp', ...(port ? ['--port', String(port)] : [])];
  const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const log = fs.createWriteStream(logFile);
  const stderr = [];
  child.stderr.on('data', (b) => stderr.push(b.toString()));

  const tap = (dir) => {
    let buf = '';
    return (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) log.write(JSON.stringify({ dir, msg: safeParse(line) }) + '\n');
      }
    };
  };
  const fromAgent = new PassThrough();
  child.stdout.on('data', tap('agent->client'));
  child.stdout.pipe(fromAgent);
  const toClientTap = tap('client->agent');
  const toAgent = new Writable({ write(chunk, _enc, cb) { toClientTap(chunk); child.stdin.write(chunk, cb); } });

  const conn = new acp.ClientSideConnection(() => ({
    requestPermission: handlers.requestPermission ?? (async () => ({ outcome: { outcome: 'cancelled' } })),
    sessionUpdate: handlers.sessionUpdate ?? (async () => {}),
  }), acp.ndJsonStream(Writable.toWeb(toAgent), Readable.toWeb(fromAgent)));

  const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
  const close = async () => {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => log.end(r));
  };
  return { conn, child, stderr, exited, close, bin };
}

export async function handshake(conn, cwd, mcpServers = []) {
  const init = await conn.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'grove-bench-spike', version: '0.0.0' },
  });
  const session = await conn.newSession({ cwd, mcpServers });
  return { init, session };
}

export function withTimeout(p, ms, label) {
  let timer;
  const expire = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout: ${label}`)), ms); });
  return Promise.race([p, expire]).finally(() => clearTimeout(timer));
}

export async function attempt(fn) {
  try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e }; }
}

/** One line per finding, collected and printed at the end. */
export function reporter() {
  const rows = [];
  return {
    check(name, pass, detail = '') {
      rows.push({ name, pass, detail });
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    },
    note(name, detail) {
      rows.push({ name, pass: null, detail });
      console.log(`INFO  ${name}: ${detail}`);
    },
    summary() {
      const failed = rows.filter((r) => r.pass === false).length;
      console.log(`\n${rows.filter((r) => r.pass).length} passed, ${failed} failed, ${rows.filter((r) => r.pass === null).length} notes`);
      return failed;
    },
  };
}

/** Where a normal OpenCode install could keep its files, taken from the real
 *  environment (not the isolated one). Generous on purpose: the point is to
 *  prove the isolated agent never touches any of them. */
export function userOpencodeDirs(env = process.env) {
  const home = os.homedir();
  const dirs = [
    path.join(home, '.local', 'share', 'opencode'),
    path.join(home, '.config', 'opencode'),
    path.join(home, '.cache', 'opencode'),
    path.join(home, '.local', 'state', 'opencode'),
    path.join(home, '.opencode'),
  ];
  for (const k of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) if (env[k]) dirs.push(path.join(env[k], 'opencode'));
  for (const k of ['APPDATA', 'LOCALAPPDATA']) if (env[k]) dirs.push(path.join(env[k], 'opencode'));
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

/** Path -> "size:mtime" for every file under `dirs` (plus a marker per
 *  existing dir), capped so a huge snapshot folder can't stall the run. */
export function snapshotDirs(dirs, cap = 50000) {
  const out = new Map();
  let capped = false;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    out.set(d + path.sep, 'dir');
    for (const e of entries) {
      if (out.size >= cap) { capped = true; return; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { const st = fs.statSync(p); out.set(p, `${st.size}:${st.mtimeMs}`); } catch {} }
    }
  };
  for (const d of dirs) walk(d);
  return { files: out, capped };
}

export function diffSnapshots(before, after) {
  const changes = [];
  for (const [p, v] of after.files) if (before.files.get(p) !== v) changes.push(`${before.files.has(p) ? 'changed' : 'added'} ${p}`);
  for (const p of before.files.keys()) if (!after.files.has(p)) changes.push(`removed ${p}`);
  return changes;
}

/** Shrink a recording for the repo: trim the 300+ entry model list and
 *  replace temp paths. */
export function trimRecording(src, dest, root) {
  const esc = root.replaceAll('\\', '\\\\');
  const lines = fs.readFileSync(src, 'utf8').trim().split('\n').map((l) => {
    const rec = JSON.parse(l);
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.id === 'model' && Array.isArray(o.options) && o.options.length > 8) {
        const keep = o.options.filter((x) => /deepseek-v4/.test(x.value)).slice(0, 4);
        o.options = [...keep, { value: '...', name: `${o.options.length - keep.length} more trimmed` }];
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(rec);
    return JSON.stringify(rec).replaceAll(esc, '<TMP>').replaceAll(root, '<TMP>');
  });
  fs.writeFileSync(dest, lines.join('\n') + '\n');
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return { raw: line }; }
}
