/**
 * The commands the main process runs (taskkill, ps, the editor CLIs, where)
 * go to the process host, and npm install, the claude CLI, gh and typeperf
 * to the agent host, which also kills their trees: none starts in the main
 * process, where a slow launch freezes the window.
 *
 * The real hosts (process-host.ts) run here on stand-in utility processes.
 * execa and Node's child_process are mocked, so a command that started in
 * this process instead would show up there.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { utilityProcess } from 'electron';
import { HOST_READY, type HostRequest, type ProcessResult, type SerializedError, type SpawnRequest, type StdioRequest } from './process-host-protocol.js';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), fork: vi.fn() }));
vi.mock('node:child_process', () => ({ ...childProcess, default: childProcess }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./credentials.js', () => ({ getApiKey: vi.fn(() => null) }));

import { DEADLINE_MARGIN_MS, HOST_STOPPED_MESSAGE, RESTART_DELAY_MS, spawnProcess, startProcessHost, stopProcessHost } from './process-host.js';
import { freezeLog } from './freeze-log.js';
import { killDescendants, listProcesses } from './process-tree.js';
import { launchEditor } from './editor-launch.js';
import { installDependencies } from './deps-install.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { git } from './git.js';
import { GH_TIMEOUT_MS, ghAuthenticated, ghVersion, prCreate, prStatus, prSubmitReview, resetGhOfflineCooldownForTests } from './gh.js';
import { measureProcesses, resetForTests, typeperfArgs, PROCESS_V2, TYPEPERF_TIMEOUT_MS } from './process-memory.js';

/** A stand-in for a utility process: keeps what it is sent (as it would
 *  arrive, so data that can't be posted fails here) and answers it. */
class FakeUtilityProcess extends EventEmitter {
  sent: unknown[] = [];
  /** How often it was killed: a host is killed when it is taken for hung. */
  kills = 0;
  constructor(readonly pid: number, private readonly answer: (message: unknown, host: FakeUtilityProcess) => void) {
    super();
  }
  postMessage(message: unknown): void {
    const arrived = structuredClone(message);
    this.sent.push(arrived);
    queueMicrotask(() => this.answer(arrived, this));
  }
  kill(): boolean {
    this.kills++;
    return true;
  }
}

/** What the process host's commands print, by command, and whether one
 *  goes unanswered (`hold`) until the test answers it (`heldCommands`). */
let respond: (request: HostRequest) => Partial<ProcessResult> & { hold?: boolean } = () => ({});
/** Answers a held command. */
const heldCommands: (() => void)[] = [];

/** A process host that answers each command with `respond`. */
const newProcessHost = () => new FakeUtilityProcess(5150, (message, host) => {
  const request = message as HostRequest;
  const { hold, ...printed } = respond(request);
  const answer = () => host.emit('message', {
    id: request.id,
    ok: true,
    launchMs: 1,
    result: { stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false, ...printed },
  });
  if (hold) heldCommands.push(answer);
  else answer();
});
/** The process host now: a restart forks a new one. */
let processHost = newProcessHost();

/** What the agent host's processes print and exit with (0 unless `code`),
 *  by request; whether one keeps running (`hold`) until the test ends it
 *  (`held`); or the `error` that keeps one from starting. */
let respondSpawn: (request: SpawnRequest) => { stdout?: string; stderr?: string; code?: number; error?: SerializedError; hold?: boolean } = () => ({});
/** Ends a held process with an exit code. */
const held: ((code: number) => void)[] = [];

/** An agent host that starts each process, which prints what respondSpawn
 *  says and exits, unless held. */
const newAgentHost = () => new FakeUtilityProcess(5151, (message, host) => {
  // A tree kill is done at once; the test ends the process (held).
  if ((message as StdioRequest).type === 'kill-tree') {
    host.emit('message', { type: 'tree-killed', id: (message as StdioRequest).id, killed: true });
    return;
  }
  const request = message as SpawnRequest;
  if (request.type !== 'spawn') return;
  const { id } = request;
  const { stdout, stderr, code = 0, error, hold } = respondSpawn(request);
  if (error) {
    host.emit('message', { type: 'error', id, error });
    host.emit('message', { type: 'close', id });
    return;
  }
  host.emit('message', { type: 'spawned', id, pid: 999, launchMs: 1 });
  if (stdout) host.emit('message', { type: 'stdout', id, data: stdout });
  if (stderr) host.emit('message', { type: 'stderr', id, data: stderr });
  const finish = (exitCode: number) => {
    for (const event of [
      { type: 'stdout-end', id },
      { type: 'stderr-end', id },
      { type: 'exit', id, code: exitCode, signal: null },
      { type: 'close', id },
    ]) host.emit('message', event);
  };
  if (hold) held.push(finish);
  else finish(code);
});
/** The agent host now: a restart forks a new one. */
let agentHost = newAgentHost();

/** The commands each host was sent, as `file args options`. */
const commands = () => (processHost.sent as HostRequest[]).map(({ file, args, options }) => ({ file, args, options }));
/** The processes the agent host was asked to start. */
const spawns = () => (agentHost.sent as SpawnRequest[]).filter((m) => m.type === 'spawn');
/** The tree kills the agent host was asked for. */
const treeKills = () => (agentHost.sent as StdioRequest[]).filter((m) => m.type === 'kill-tree');

/** The next fork() is node-pty's console list helper for a shell, which
 *  lists `pids` as on the console (itself first). */
function consoleHelper(pids: number[]) {
  childProcess.fork.mockImplementationOnce(() => {
    const helper = Object.assign(new EventEmitter(), { pid: pids[0], kill: vi.fn() });
    queueMicrotask(() => {
      helper.emit('message', { consoleProcessList: pids });
      helper.emit('close', 0);
    });
    return helper;
  });
}

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeAll(() => {
  vi.mocked(utilityProcess.fork).mockImplementation(((_script: string, _args: string[], options: { serviceName?: string }) =>
    (options.serviceName === 'Grove agent host' ? agentHost : processHost)) as never);
  startProcessHost();
  processHost.emit('message', HOST_READY);
  agentHost.emit('message', HOST_READY);
});

afterAll(() => {
  stopProcessHost();
});

beforeEach(() => {
  processHost.sent = [];
  agentHost.sent = [];
  respond = () => ({});
  respondSpawn = () => ({});
  mockExeca.mockReset();
});

afterEach(() => {
  setPlatform(realPlatform);
  // Nothing started in this process.
  expect(mockExeca).not.toHaveBeenCalled();
  expect(childProcess.execFile).not.toHaveBeenCalled();
  expect(childProcess.spawn).not.toHaveBeenCalled();
});

describe('commands the main process runs start in the process host', () => {
  it('taskkill, when a terminal closes (killDescendants)', async () => {
    setPlatform('win32');
    // The helper itself (9000), a dev server (700) and the shell (500).
    consoleHelper([9000, 700, 500]);
    expect(await killDescendants(500)).toEqual([700]);
    expect(commands()).toEqual([{
      file: expect.stringMatching(/\\System32\\taskkill\.exe$/i),
      args: ['/PID', '700', '/T', '/F'],
      options: { timeout: 10_000, reject: false },
    }]);
  });

  it('ps, to find a process tree off Windows (listProcesses)', async () => {
    setPlatform('linux');
    respond = () => ({ stdout: '1 0\n200 1\n' });
    expect(await listProcesses()).toEqual([{ pid: 1, ppid: 0 }, { pid: 200, ppid: 1 }]);
    expect(commands()).toEqual([{ file: 'ps', args: ['-A', '-o', 'pid=,ppid='], options: { timeout: 10_000, reject: false } }]);
  });

  it('the editor CLI, to open a file (launchEditor)', async () => {
    expect(await launchEditor('code', '/repo/src/a.ts', 7)).toBe(true);
    expect(commands()).toEqual([{ file: 'code', args: ['-g', '/repo/src/a.ts:7'], options: undefined }]);
  });

  it('a command asked for while the process host restarts waits for it, but taskkill runs here at once', async () => {
    setPlatform('win32');
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let opened: Promise<boolean>;
    let killed: Promise<number[]>;
    try {
      processHost.emit('exit', 1);
      processHost = newProcessHost();
      opened = launchEditor('code', '/repo/src/a.ts', 7);
      // Killing can't wait: the terminal's processes keep running until then.
      consoleHelper([9000, 700, 500]);
      killed = killDescendants(500);
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockExeca.mock.calls).toEqual([[
        expect.stringMatching(/\\System32\\taskkill\.exe$/i),
        ['/PID', '700', '/T', '/F'],
        { timeout: 10_000, reject: false },
      ]]);
      vi.advanceTimersByTime(RESTART_DELAY_MS);
      expect(processHost.sent).toEqual([]);
      processHost.emit('message', HOST_READY);
    } finally {
      vi.useRealTimers();
    }
    await killed;
    expect(await opened).toBe(true);
    expect(commands()).toEqual([{ file: 'code', args: ['-g', '/repo/src/a.ts:7'], options: undefined }]);
    // The one launch here this file expects (afterEach checks there are none).
    mockExeca.mockReset();
  });
});

describe('the claude CLI starts in the agent host, its lookup in the process host', () => {
  const AUTH_ENV = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(AUTH_ENV.map((k) => [k, process.env[k]]));
    for (const k of AUTH_ENV) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('where and auth status, to check Claude Code is installed and signed in (checkPrerequisites)', async () => {
    setPlatform('win32');
    respond = () => ({ stdout: 'C:\\bin\\claude.exe' });
    respondSpawn = () => ({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}\r\n' });
    expect(await new ClaudeCodeAdapter().checkPrerequisites()).toMatchObject({ available: true, path: 'C:\\bin\\claude.exe', authenticated: true, authMethod: 'claude.ai' });
    // A short lookup with no shell, which its timeout really ends.
    expect(commands()).toEqual([{ file: 'where.exe', args: ['claude'], options: { timeout: 10_000 } }]);
    // Its command line in a shell, with the environment it would inherit, and
    // the CLI's path quoted, as cmd.exe would cut one with a space short.
    expect(spawns()).toEqual([{ type: 'spawn', id: expect.any(Number), file: '"C:\\bin\\claude.exe"', args: ['auth', 'status', '--json'], shell: true }]);
  });

  it("auth status for another account, with that account's whole environment", async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-shell';
    respond = () => ({ stdout: '/usr/bin/claude' });
    respondSpawn = () => ({ stdout: '{"loggedIn":true}' });
    const account = new ClaudeCodeAdapter(undefined, { id: 'claude-account-work', name: 'Work', configDir: '/home/me/.claude-work' });
    expect(await account.checkPrerequisites()).toMatchObject({ authenticated: true });
    const [auth] = spawns();
    expect(auth).toMatchObject({ args: ['auth', 'status', '--json'], shell: true, env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/home/me/.claude-work' }) });
    // A spawn's env is the whole environment: the key left out stays out.
    expect(auth.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('mcp list, add and remove', async () => {
    const adapter = new ClaudeCodeAdapter();
    await adapter.listConfiguredMcpServers('/repo');
    await adapter.addConfiguredMcpServer({ name: 'docs', transport: 'http', scope: 'user', commandOrUrl: 'https://example.com/mcp' });
    await adapter.removeConfiguredMcpServer('docs', 'user');
    expect(commands()).toEqual([]);
    expect(spawns()).toEqual([
      { type: 'spawn', id: expect.any(Number), file: 'claude', args: ['mcp', 'list'], cwd: '/repo', shell: true },
      { type: 'spawn', id: expect.any(Number), file: 'claude', args: ['mcp', 'add', '-s', 'user', '-t', 'http', 'docs', 'https://example.com/mcp'], shell: true },
      { type: 'spawn', id: expect.any(Number), file: 'claude', args: ['mcp', 'remove', '-s', 'user', 'docs'], shell: true },
    ]);
  });

  it('plugin list, install, uninstall, enable and disable', async () => {
    respondSpawn = ({ args }) => ({ stdout: args[1] === 'list' ? '{"installed":[],"available":[]}\n' : '' });
    const adapter = new ClaudeCodeAdapter();
    expect(await adapter.listPlugins()).toEqual({ installed: [], available: [] });
    await adapter.installPlugin('p@m');
    await adapter.uninstallPlugin('p@m');
    await adapter.enablePlugin('p@m');
    await adapter.disablePlugin('p@m');
    expect(commands()).toEqual([]);
    expect(spawns().map(({ file, args, shell }) => ({ file, args, shell }))).toEqual([
      { file: 'claude', args: ['plugin', 'list', '--json', '--available'], shell: true },
      { file: 'claude', args: ['plugin', 'install', 'p@m', '--scope', 'user'], shell: true },
      { file: 'claude', args: ['plugin', 'uninstall', 'p@m'], shell: true },
      { file: 'claude', args: ['plugin', 'enable', 'p@m'], shell: true },
      { file: 'claude', args: ['plugin', 'disable', 'p@m'], shell: true },
    ]);
  });

  it('at its time limit, its whole tree is killed, by the agent host it runs in', async () => {
    setPlatform('win32');
    respondSpawn = () => ({ hold: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const listed = new ClaudeCodeAdapter().listConfiguredMcpServers('/repo').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await listed).toMatchObject({ timedOut: true });
      // cmd.exe, which the claude CLI runs under, and what it started.
      expect(treeKills()).toEqual([{ type: 'kill-tree', id: spawns()[0].id }]);
      expect(commands()).toEqual([]);
    } finally {
      vi.useRealTimers();
      for (const finish of held.splice(0)) finish(1);
    }
  });

  it('keeps running when the process host is restarted', async () => {
    respondSpawn = ({ args }) => ({ hold: args[1] === 'install' });
    const install = new ClaudeCodeAdapter().installPlugin('p@m');
    await vi.waitFor(() => expect(held).toHaveLength(1));

    // The process host dies, as when a hung command gets it restarted, and
    // comes back.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      processHost.emit('exit', 1);
      processHost = newProcessHost();
      vi.advanceTimersByTime(RESTART_DELAY_MS);
      processHost.emit('message', HOST_READY);
    } finally {
      vi.useRealTimers();
    }

    held.splice(0)[0](0);
    await expect(install).resolves.toBeUndefined();
    expect(commands()).toEqual([]);
  });
});

describe('typeperf, for the health line, starts in the agent host', () => {
  const v2Sample = [
    '',
    '"(PDH-CSV 4.0) (GMT Daylight Time)(-60)","\\\\PC\\Process V2(claude:2210)\\Process ID","\\\\PC\\Process V2(claude:2210)\\Creating Process ID","\\\\PC\\Process V2(claude:2210)\\Private Bytes","\\\\PC\\Process V2(claude:2210)\\Elapsed Time"',
    '"10/23/2026 09:00:01.234","2210.000000","5151.000000","524288000.000000","600.000000"',
    '',
  ].join('\r\n');
  const measure = () => measureProcesses({ agents: () => [{ thread: 'aaaa1111', pid: 2210, exe: 'claude.exe' }], platform: 'win32', note: () => {} });

  beforeEach(() => resetForTests());

  it('to list the processes (measureProcesses), so a hang there never restarts the git host', async () => {
    respondSpawn = () => ({ stdout: v2Sample });
    expect(await measure()).toMatchObject({ agents: { agents: 1, byExe: [{ name: 'claude.exe', count: 1 }] } });
    expect(commands()).toEqual([]);
    expect(spawns()).toEqual([{ type: 'spawn', id: expect.any(Number), file: expect.stringMatching(/\\System32\\typeperf\.exe$/i), args: typeperfArgs(PROCESS_V2) }]);
  });

  it("its output, like gh's, isn't counted as agent output on the health line, while an agent's is", async () => {
    resetGhOfflineCooldownForTests();
    const pr = JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' });
    const agentLine = '{"type":"system","subtype":"init"}\n';
    respondSpawn = ({ file }) => ({ stdout: file === 'gh' ? pr : /typeperf\.exe$/i.test(file) ? v2Sample : agentLine });
    freezeLog.takeStats();
    expect(await measure()).toMatchObject({ agents: { agents: 1 } });
    expect(await prStatus('/repo', 'feat/x')).toMatchObject({ number: 7 });
    expect(freezeLog.takeStats().agentOutput.chars).toBe(0);

    // An agent's program, started as the adapters start it.
    const agent = spawnProcess('claude.exe', ['--output-format', 'stream-json']);
    await new Promise((resolve) => agent.once('close', resolve));
    expect(freezeLog.takeStats().agentOutput.chars).toBe(agentLine.length);
  });

  it("which leaves itself out of the agents: it's the agent host's child, but a command it ran (recordCommandPids)", async () => {
    // The agent host (5151), a thread's agent under it, and typeperf (999,
    // as the fake host starts every process) with its console host.
    const instances: [string, number, number, number, number][] = [
      ['Grove Bench:5151', 5151, 5150, 40, 1000],
      ['claude:2210', 2210, 5151, 500, 600],
      ['typeperf:999', 999, 5151, 3, 1],
      ['conhost:1000', 1000, 999, 6, 1],
    ];
    const counters = ['Process ID', 'Creating Process ID', 'Private Bytes', 'Elapsed Time'];
    const csv = (fields: string[]) => fields.map((f) => `"${f}"`).join(',');
    respondSpawn = () => ({
      stdout: ['', csv(['(PDH-CSV 4.0)', ...counters.flatMap((c) => instances.map(([name]) => `\\\\PC\\Process V2(${name})\\${c}`))]),
        csv(['10/23/2026 09:00:01.234', ...counters.flatMap((_, i) => instances.map(([, ...values]) => (values[i] * (i === 2 ? 1024 * 1024 : 1)).toFixed(6)))]), ''].join('\r\n'),
    });
    expect(await measureProcesses({
      agents: () => [{ thread: 'aaaa1111', pid: 2210, exe: 'claude.exe' }], agentHostPid: () => 5151, platform: 'win32', note: () => {},
    })).toEqual({
      counters: 'Process V2',
      agents: { agents: 1, untracked: 0, byExe: [{ name: 'claude.exe', count: 1, bytes: 500 * 1024 * 1024 }], largest: [expect.objectContaining({ pid: 2210 })] },
      devServer: null,
    });
  });

  it('at its time limit, its whole tree is killed, by the agent host it runs in', async () => {
    setPlatform('win32');
    respondSpawn = () => ({ hold: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const measured = measure();
      await vi.advanceTimersByTimeAsync(TYPEPERF_TIMEOUT_MS);
      expect(await measured).toBeNull();
      expect(treeKills()).toEqual([{ type: 'kill-tree', id: spawns()[0].id }]);
      expect(commands()).toEqual([]);
    } finally {
      vi.useRealTimers();
      for (const finish of held.splice(0)) finish(1);
    }
  });
});

describe('npm install starts in the agent host', () => {
  it('for a new worktree (installDependencies)', async () => {
    await installDependencies('/wt', 'npm', new AbortController().signal);
    expect(processHost.sent).toEqual([]);
    expect(agentHost.sent).toEqual([
      { type: 'spawn', id: expect.any(Number), file: 'npm', args: ['install', '--prefer-offline', '--no-audit', '--no-fund'], cwd: '/wt', findCommand: true, stdout: 'ignore' },
    ]);
  });
});

describe('gh starts in the agent host, never in the process host with git', () => {
  beforeEach(() => {
    resetGhOfflineCooldownForTests();
  });

  it('with its args and cwd, found on PATH as execa found it, and its input on stdin', async () => {
    respondSpawn = ({ args }) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.81.0 (2025-10-01)\n' };
      if (args[0] === 'pr') return { stdout: JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }) };
      // The review: answered once its input has arrived.
      if (args.includes('--input')) return { stdout: '{"html_url":"https://github.com/o/r/pull/7#pullrequestreview-1"}', hold: true };
      return {};
    };
    expect(await ghVersion()).toBe('2.81.0');
    expect(await ghAuthenticated()).toBe(true);
    expect(await prStatus('/repo', 'feat/x')).toMatchObject({ number: 7 });
    const posted = prSubmitReview('/repo', 7, { event: 'APPROVE', body: '', comments: [] });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const review = spawns()[3];
    const input = () => (agentHost.sent as { type: string; id: number }[]).filter((m) => m.id === review.id && m.type !== 'spawn');
    await vi.waitFor(() => expect(input()).toEqual([
      { type: 'stdin', id: review.id, data: '{"event":"APPROVE"}' },
      { type: 'stdin-end', id: review.id },
    ] satisfies StdioRequest[]));
    held.splice(0)[0](0);
    expect(await posted).toEqual({ url: 'https://github.com/o/r/pull/7#pullrequestreview-1' });

    expect(commands()).toEqual([]);
    // No env: the host's own, as execa's in the process host was. No shell:
    // findCommand finds gh.exe on PATH (cross-spawn), as execa did.
    expect(spawns()).toEqual([
      { type: 'spawn', id: expect.any(Number), file: 'gh', args: ['--version'], findCommand: true },
      { type: 'spawn', id: expect.any(Number), file: 'gh', args: ['auth', 'status'], findCommand: true },
      { type: 'spawn', id: expect.any(Number), file: 'gh', args: ['pr', 'view', 'feat/x', '--json', expect.any(String)], cwd: '/repo', findCommand: true },
      { type: 'spawn', id: expect.any(Number), file: 'gh', args: ['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-'], cwd: '/repo', findCommand: true },
    ]);
  });

  it('not installed, not signed in, or no PR: callers read it as before', async () => {
    // The host reports a program it can't find as Node does, on Windows too.
    respondSpawn = () => ({ error: { name: 'Error', message: 'spawn gh ENOENT', code: 'ENOENT', syscall: 'spawn gh', path: 'gh' } });
    expect(await ghVersion()).toBeNull();

    respondSpawn = () => ({ code: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' });
    expect(await ghAuthenticated()).toBe(false);

    respondSpawn = () => ({ code: 1, stderr: 'no pull requests found for branch "feat/x"\n' });
    expect(await prStatus('/repo', 'feat/x')).toBeNull();

    respondSpawn = () => ({ code: 1, stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\n' });
    await expect(prStatus('/repo', 'feat/x')).rejects.toThrow('gh pr view failed: HTTP 401: Bad credentials (https://api.github.com/graphql)');

    respondSpawn = () => ({ code: 1, stderr: 'a pull request for branch "feat/x" into branch "main" already exists:\nhttps://github.com/o/r/pull/7\n' });
    await expect(prCreate('/repo', 'feat/x', { title: 'T', body: '', base: 'main' }))
      .rejects.toThrow('a pull request for branch "feat/x" into branch "main" already exists:\nhttps://github.com/o/r/pull/7');
    expect(commands()).toEqual([]);
  });

  it('a hung gh is stopped at its time limit, its whole tree killed; neither host restarts, and git carries on', async () => {
    setPlatform('win32');
    respondSpawn = () => ({ hold: true });
    // A checkpoint's `git add`, running in the process host meanwhile.
    respond = ({ file }) => ({ hold: file === 'git' });
    const forks = vi.mocked(utilityProcess.fork).mock.calls.length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const status = prStatus('/repo', 'feat/x').catch((e: unknown) => e);
      const added = git(['add', '-A'], '/wt');
      await vi.advanceTimersByTimeAsync(GH_TIMEOUT_MS);
      expect(await status).toMatchObject({ message: expect.stringMatching(/^gh pr view failed: Command timed out after 30000 milliseconds: gh pr view feat\/x /) });
      // gh, killed with whatever it started by the agent host it runs in.
      expect(treeKills()).toEqual([{ type: 'kill-tree', id: spawns()[0].id }]);
      expect(commands()).toEqual([{ file: 'git', args: ['add', '-A'], options: { cwd: '/wt' } }]);

      // Long past when the process host would have been taken for hung,
      // had gh run there: nothing is killed or started again.
      await vi.advanceTimersByTimeAsync(2 * (GH_TIMEOUT_MS + DEADLINE_MARGIN_MS));
      expect(processHost.kills).toBe(0);
      expect(agentHost.kills).toBe(0);
      expect(vi.mocked(utilityProcess.fork).mock.calls.length).toBe(forks);

      heldCommands.splice(0).forEach((answer) => answer());
      await expect(added).resolves.toBe('');
    } finally {
      vi.useRealTimers();
      for (const finish of held.splice(0)) finish(1);
      heldCommands.splice(0).forEach((answer) => answer());
    }
  });

  it('a call made while the agent host restarts gets its whole time limit once it has started there', async () => {
    setPlatform('win32');
    // The dead host's processes are stopped by pid: not really, here.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    respondSpawn = () => ({ hold: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      agentHost.emit('exit', 1);
      agentHost = newAgentHost();
      let settled = false;
      const status = prStatus('/repo', 'feat/x').finally(() => { settled = true; }).catch((e: unknown) => e);
      // A slow restart: the pause before it, then 8 s to come up.
      await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS + 8_000);
      expect(spawns()).toEqual([]);
      agentHost.emit('message', HOST_READY);
      await vi.advanceTimersByTimeAsync(0);
      expect(spawns()).toHaveLength(1);

      // Past GH_TIMEOUT_MS from the call, but not from the start.
      await vi.advanceTimersByTimeAsync(GH_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await status).toMatchObject({ message: expect.stringMatching(/^gh pr view failed: Command timed out after 30000 milliseconds: gh pr view feat\/x /) });
      expect(treeKills()).toEqual([{ type: 'kill-tree', id: spawns()[0].id }]);
      expect(commands()).toEqual([]);
    } finally {
      vi.useRealTimers();
      kill.mockRestore();
      for (const finish of held.splice(0)) finish(1);
    }
  });

  it('a call that only reads runs again if the agent host dies under it; one that writes fails', async () => {
    // The dead host's processes are stopped by pid: not really, here.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    let views = 0;
    respondSpawn = ({ args }) => (args[1] === 'view' && ++views > 1
      ? { stdout: JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }) }
      : { hold: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const status = prStatus('/repo', 'feat/x');
      const created = prCreate('/repo', 'feat/x', { title: 'T', body: '', base: '' }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(held).toHaveLength(2);
      const [view, create] = spawns();
      expect([view.args.slice(0, 2), create.args.slice(0, 2)]).toEqual([['pr', 'view'], ['pr', 'create']]);

      agentHost.emit('exit', 1);
      agentHost = newAgentHost();
      await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);
      agentHost.emit('message', HOST_READY);

      expect(await status).toMatchObject({ number: 7 });
      expect(await created).toMatchObject({ message: expect.stringContaining(`${HOST_STOPPED_MESSAGE}: gh pr create`) });
      expect(kill).toHaveBeenCalledWith(999);
      // Only the view, again, as it was.
      expect(spawns()).toEqual([{ ...view, id: expect.any(Number) }]);
      expect(commands()).toEqual([]);
    } finally {
      vi.useRealTimers();
      kill.mockRestore();
      held.splice(0);
    }
  });
});
