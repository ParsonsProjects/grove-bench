/**
 * The commands the main process runs (taskkill, ps, rmdir, the editor CLIs,
 * the claude CLI) go to the process host, and npm install to the agent host:
 * none starts in the main process, where a slow launch freezes the window.
 *
 * The real hosts (process-host.ts) run here on stand-in utility processes.
 * execa and Node's child_process are mocked, so a command that started in
 * this process instead would show up there.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { utilityProcess } from 'electron';
import { HOST_READY, type HostRequest, type ProcessResult, type SpawnRequest } from './process-host-protocol.js';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
const childProcess = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn(), fork: vi.fn() }));
vi.mock('node:child_process', () => ({ ...childProcess, default: childProcess }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./credentials.js', () => ({ getApiKey: vi.fn(() => null) }));

import { startProcessHost, stopProcessHost } from './process-host.js';
import { killTree, listProcesses } from './process-tree.js';
import { removeDirectory } from './fs-utils.js';
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

const processHost = new FakeUtilityProcess(5150, (message, host) => {
  const request = message as HostRequest;
  host.emit('message', {
    id: request.id,
    ok: true,
    launchMs: 1,
    result: { stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false, ...respond(request) },
  });
});

/** The agent host starts each process, which exits at once with 0. */
const agentHost = new FakeUtilityProcess(5151, (message, host) => {
  const request = message as SpawnRequest;
  if (request.type !== 'spawn') return;
  const { id } = request;
  for (const event of [
    { type: 'spawned', id, pid: 999, launchMs: 1 },
    { type: 'stdout-end', id },
    { type: 'stderr-end', id },
    { type: 'exit', id, code: 0, signal: null },
    { type: 'close', id },
  ]) host.emit('message', event);
});

/** The commands each host was sent, as `file args options`. */
const commands = () => (processHost.sent as HostRequest[]).map(({ file, args, options }) => ({ file, args, options }));

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

  it('rmdir, when a worktree is deleted (removeDirectory)', async () => {
    setPlatform('win32');
    // Gone once rmdir has run, so fs.rm isn't needed.
    const dir = path.join(os.tmpdir(), `grove-never-there-${process.pid}-${Date.now()}`);
    await removeDirectory(dir);
    expect(commands()).toEqual([{
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `rmdir /s /q "${dir}"`],
      options: { reject: false, timeout: 5 * 60_000 },
    }]);
  });

  it('the editor CLI, to open a file (launchEditor)', async () => {
    expect(await launchEditor('code', '/repo/src/a.ts', 7)).toBe(true);
    expect(commands()).toEqual([{ file: 'code', args: ['-g', '/repo/src/a.ts:7'], options: undefined }]);
  });

  describe('the claude CLI', () => {
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
      respond = ({ args }) => ({ stdout: args[0] === 'claude' ? 'C:\\bin\\claude.exe' : '{"loggedIn":true,"authMethod":"claude.ai"}' });
      expect(await new ClaudeCodeAdapter().checkPrerequisites()).toMatchObject({ available: true, path: 'C:\\bin\\claude.exe', authenticated: true });
      expect(commands()).toEqual([
        { file: 'where.exe', args: ['claude'], options: { timeout: 10_000 } },
        { file: 'C:\\bin\\claude.exe', args: ['auth', 'status', '--json'], options: { timeout: 15_000, shell: true } },
      ]);
    });

    it("auth status for another account, with that account's whole environment", async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-shell';
      respond = ({ args }) => ({ stdout: args[0] === 'claude' ? '/usr/bin/claude' : '{"loggedIn":true}' });
      const account = new ClaudeCodeAdapter(undefined, { id: 'claude-account-work', name: 'Work', configDir: '/home/me/.claude-work' });
      await account.checkPrerequisites();
      const auth = commands()[1];
      expect(auth.options).toMatchObject({ shell: true, extendEnv: false, env: expect.objectContaining({ CLAUDE_CONFIG_DIR: '/home/me/.claude-work' }) });
      expect(auth.options?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    it('mcp list, add and remove', async () => {
      const adapter = new ClaudeCodeAdapter();
      await adapter.listConfiguredMcpServers('/repo');
      await adapter.addConfiguredMcpServer({ name: 'docs', transport: 'http', scope: 'user', commandOrUrl: 'https://example.com/mcp' });
      await adapter.removeConfiguredMcpServer('docs', 'user');
      expect(commands()).toEqual([
        { file: 'claude', args: ['mcp', 'list'], options: { shell: true, cwd: '/repo', timeout: 60_000 } },
        { file: 'claude', args: ['mcp', 'add', '-s', 'user', '-t', 'http', 'docs', 'https://example.com/mcp'], options: { shell: true, timeout: 30_000 } },
        { file: 'claude', args: ['mcp', 'remove', '-s', 'user', 'docs'], options: { shell: true, timeout: 30_000 } },
      ]);
    });

    it('plugin list, install, uninstall, enable and disable', async () => {
      respond = ({ args }) => ({ stdout: args[1] === 'list' ? '{"installed":[],"available":[]}' : '' });
      const adapter = new ClaudeCodeAdapter();
      expect(await adapter.listPlugins()).toEqual({ installed: [], available: [] });
      await adapter.installPlugin('p@m');
      await adapter.uninstallPlugin('p@m');
      await adapter.enablePlugin('p@m');
      await adapter.disablePlugin('p@m');
      expect(commands()).toEqual([
        { file: 'claude', args: ['plugin', 'list', '--json', '--available'], options: { shell: true } },
        { file: 'claude', args: ['plugin', 'install', 'p@m', '--scope', 'user'], options: { shell: true } },
        { file: 'claude', args: ['plugin', 'uninstall', 'p@m'], options: { shell: true } },
        { file: 'claude', args: ['plugin', 'enable', 'p@m'], options: { shell: true } },
        { file: 'claude', args: ['plugin', 'disable', 'p@m'], options: { shell: true } },
      ]);
    });
  });
});

describe('npm install starts in the agent host', () => {
  it('for a new worktree (installDependencies)', async () => {
    await installDependencies('/wt', '/cache', new AbortController().signal);
    expect(processHost.sent).toEqual([]);
    expect(agentHost.sent).toEqual([
      { type: 'spawn', id: expect.any(Number), file: 'npm', args: ['install', '--prefer-offline', '--cache', '/cache'], cwd: '/wt', findCommand: true },
    ]);
  });
});
