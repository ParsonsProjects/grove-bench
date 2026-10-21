/**
 * The commands the main process runs (taskkill, ps, the editor CLIs, where)
 * go to the process host, and npm install and the claude CLI to the agent
 * host: none starts in the main process, where a slow launch freezes the
 * window.
 *
 * The real hosts (process-host.ts) run here on stand-in utility processes.
 * execa and Node's child_process are mocked, so a command that started in
 * this process instead would show up there.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { utilityProcess } from 'electron';
import { HOST_READY, type HostRequest, type ProcessResult, type SpawnRequest } from './process-host-protocol.js';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), fork: vi.fn() }));
vi.mock('node:child_process', () => ({ ...childProcess, default: childProcess }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./credentials.js', () => ({ getApiKey: vi.fn(() => null) }));

import { RESTART_DELAY_MS, startProcessHost, stopProcessHost } from './process-host.js';
import { killTree, listProcesses } from './process-tree.js';
import { launchEditor } from './editor-launch.js';
import { installDependencies } from './deps-install.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';

/** A stand-in for a utility process: keeps what it is sent (as it would
 *  arrive, so data that can't be posted fails here) and answers it. */
class FakeUtilityProcess extends EventEmitter {
  sent: unknown[] = [];
  constructor(readonly pid: number, private readonly answer: (message: unknown, host: FakeUtilityProcess) => void) {
    super();
  }
  postMessage(message: unknown): void {
    const arrived = structuredClone(message);
    this.sent.push(arrived);
    queueMicrotask(() => this.answer(arrived, this));
  }
  kill(): boolean { return true; }
}

/** What the process host's commands print, by command. */
let respond: (request: HostRequest) => Partial<ProcessResult> = () => ({});

/** A process host that answers each command with `respond`. */
const newProcessHost = () => new FakeUtilityProcess(5150, (message, host) => {
  const request = message as HostRequest;
  host.emit('message', {
    id: request.id,
    ok: true,
    launchMs: 1,
    result: { stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false, ...respond(request) },
  });
});
/** The process host now: a restart forks a new one. */
let processHost = newProcessHost();

/** What the agent host's processes print, by request, and whether one keeps
 *  running (`hold`) until the test ends it (`held`). */
let respondSpawn: (request: SpawnRequest) => { stdout?: string; hold?: boolean } = () => ({});
/** Ends a held process with an exit code. */
const held: ((code: number) => void)[] = [];

/** The agent host starts each process, which prints what respondSpawn says
 *  and exits with 0, unless held. */
const agentHost = new FakeUtilityProcess(5151, (message, host) => {
  const request = message as SpawnRequest;
  if (request.type !== 'spawn') return;
  const { id } = request;
  const { stdout, hold } = respondSpawn(request);
  host.emit('message', { type: 'spawned', id, pid: 999, launchMs: 1 });
  if (stdout) host.emit('message', { type: 'stdout', id, data: stdout });
  const finish = (code: number) => {
    for (const event of [
      { type: 'stdout-end', id },
      { type: 'stderr-end', id },
      { type: 'exit', id, code, signal: null },
      { type: 'close', id },
    ]) host.emit('message', event);
  };
  if (hold) held.push(finish);
  else finish(0);
});

/** The commands each host was sent, as `file args options`. */
const commands = () => (processHost.sent as HostRequest[]).map(({ file, args, options }) => ({ file, args, options }));
/** The processes the agent host was asked to start. */
const spawns = () => (agentHost.sent as SpawnRequest[]).filter((m) => m.type === 'spawn');

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
  it('taskkill, when a thread closes or sleeps (killTree)', async () => {
    setPlatform('win32');
    await killTree(4242);
    expect(commands()).toEqual([{
      file: expect.stringMatching(/\\System32\\taskkill\.exe$/i),
      args: ['/PID', '4242', '/T', '/F'],
      options: { timeout: 10_000, reject: false },
    }]);
  });

  it('ps, to find a process tree off Windows (listProcesses)', async () => {
    setPlatform('linux');
    respond = () => ({ stdout: '1 0\n200 1\n' });
    expect(await listProcesses()).toEqual([{ pid: 1, ppid: 0 }, { pid: 200, ppid: 1 }]);
    expect(commands()).toEqual([{ file: 'ps', args: ['-A', '-o', 'pid=,ppid='], options: { timeout: 10_000 } }]);
  });

  it('the editor CLI, to open a file (launchEditor)', async () => {
    expect(await launchEditor('code', '/repo/src/a.ts', 7)).toBe(true);
    expect(commands()).toEqual([{ file: 'code', args: ['-g', '/repo/src/a.ts:7'], options: undefined }]);
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

  it('at its time limit, its whole tree is killed, by taskkill from the process host', async () => {
    setPlatform('win32');
    respondSpawn = () => ({ hold: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const listed = new ClaudeCodeAdapter().listConfiguredMcpServers('/repo').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await listed).toMatchObject({ timedOut: true });
      // 999: cmd.exe, which the claude CLI runs under.
      expect(commands()).toEqual([{
        file: expect.stringMatching(/\\System32\\taskkill\.exe$/i),
        args: ['/PID', '999', '/T', '/F'],
        options: { timeout: 10_000, reject: false },
      }]);
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

describe('npm install starts in the agent host', () => {
  it('for a new worktree (installDependencies)', async () => {
    await installDependencies('/wt', '/cache', new AbortController().signal);
    expect(processHost.sent).toEqual([]);
    expect(agentHost.sent).toEqual([
      { type: 'spawn', id: expect.any(Number), file: 'npm', args: ['install', '--prefer-offline', '--cache', '/cache'], cwd: '/wt', findCommand: true, stdout: 'ignore' },
    ]);
  });
});
