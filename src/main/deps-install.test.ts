import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createSpawnRunner, HostedProcess } from './process-host-spawn.js';

// npm install starts in the agent host (spawnProcess), never here.
const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn() }));
vi.mock('./process-host.js', () => ({ spawnProcess: hosted.spawnProcess }));
// cross-spawn's parse as on Windows with npm not on PATH: it found no
// `file`, so cmd.exe runs the command.
vi.mock('cross-spawn', () => ({
  default: {
    _parse: (command: string, args: readonly string[], options: Record<string, unknown>) => ({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `"${[command, ...args].join(' ')}"`],
      options: { ...options, windowsVerbatimArguments: true },
      file: undefined,
    }),
  },
}));
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./process-tree.js', () => ({ killTree: vi.fn(async () => {}) }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { killTree } from './process-tree.js';
import { installDependencies } from './deps-install.js';

/** A running install, driven by the test as the host would drive it. */
function fakeInstall() {
  const proc = new HostedProcess('npm install');
  hosted.spawnProcess.mockReturnValue(proc);
  const send = (event: Parameters<HostedProcess['receive']>[0]) => proc.receive(event);
  return {
    proc,
    started: (pid = 4321) => send({ type: 'spawned', id: 1, pid, launchMs: 5 }),
    stderr: (data: string) => send({ type: 'stderr', id: 1, data }),
    /** It exits with `code` (or is killed) and its output ends. */
    exit: (code: number | null, signal: string | null = null) => {
      send({ type: 'exit', id: 1, code, signal });
      send({ type: 'close', id: 1 });
    },
    failedToStart: (error: { name: string; message: string; code?: string }) => {
      send({ type: 'error', id: 1, error });
      send({ type: 'close', id: 1 });
    },
  };
}

/**
 * spawnProcess as the agent host's fallback runs it, in the main process:
 * createSpawnRunner starts the process with `spawn` inside the call, before
 * it returns.
 */
function spawnHere(spawn: Parameters<typeof createSpawnRunner>[1]) {
  hosted.spawnProcess.mockImplementation((file: string, args: string[], options: object) => {
    const proc = new HostedProcess(file);
    const runner = createSpawnRunner((event) => proc.receive(event), spawn);
    runner.handle({ type: 'spawn', id: 1, file, args, ...options });
    proc.connect((command) => runner.handle({ ...command, id: 1 }));
    return proc;
  });
}

/** A stand-in for the process Node starts, its stdout ignored. */
function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 4321, stdin: new PassThrough(), stdout: null, stderr: new PassThrough(), kill: () => true });
}

/** Let stream events (they come on the next tick) run. */
const settle = () => new Promise((r) => setImmediate(r));

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('installDependencies', () => {
  it('runs npm install with the shared cache, found as a shell would find it', async () => {
    const install = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    install.started();
    install.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('npm', ['install', '--prefer-offline', '--cache', '/cache'], expect.objectContaining({ cwd: '/wt', findCommand: true }));
  });

  it("leaves npm's output in the agent host, so it isn't timed as agent output, and keeps its stderr", async () => {
    const install = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    install.started();
    install.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('npm', expect.any(Array), { cwd: '/wt', findCommand: true, stdout: 'ignore' });
  });

  it('starts npm in the agent host, not in the main process', async () => {
    const install = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    install.started();
    install.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledOnce();
    expect(execa).not.toHaveBeenCalled();
  });

  it('kills the whole install tree on abort and rejects with the abort', async () => {
    const install = fakeInstall();
    const abort = new AbortController();
    const done = installDependencies('/wt', '/cache', abort.signal);
    install.started(4321);

    abort.abort();
    expect(killTree).toHaveBeenCalledWith(4321);
    install.exit(1);

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('kills an install aborted before it started once it starts', async () => {
    const install = fakeInstall();
    const abort = new AbortController();
    const done = installDependencies('/wt', '/cache', abort.signal);

    abort.abort();
    expect(killTree).not.toHaveBeenCalled();
    install.started(777);
    expect(killTree).toHaveBeenCalledWith(777);
    install.exit(null, 'SIGKILL');

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes a real install failure through, with what npm wrote to stderr', async () => {
    const install = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    install.started();
    install.stderr('npm ERR! 404 Not Found\n');
    await settle();
    install.exit(1);
    await expect(done).rejects.toMatchObject({ exitCode: 1, stderr: 'npm ERR! 404 Not Found', message: expect.stringContaining('npm ERR! 404') });
  });

  it('rejects with the start error, ENOENT when npm is not installed', async () => {
    const install = fakeInstall();
    const done = installDependencies('/wt', '/cache', new AbortController().signal);
    install.failedToStart({ name: 'Error', message: 'spawn npm ENOENT', code: 'ENOENT' });
    await expect(done).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects with ENOENT on Windows too, where cmd.exe runs the missing npm and exits 1', async () => {
    setPlatform('win32');
    const cmd = fakeChild();
    spawnHere((() => cmd) as unknown as Parameters<typeof createSpawnRunner>[1]);
    const done = installDependencies('C:\\wt', 'C:\\cache', new AbortController().signal);
    cmd.stderr.end("'npm' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n");
    await settle();
    cmd.emit('exit', 1, null);
    cmd.emit('close', 1, null);
    // Not "npm install failed": the caller skips an ENOENT quietly.
    await expect(done).rejects.toMatchObject({ code: 'ENOENT', syscall: 'spawn npm' });
    await expect(done).rejects.not.toHaveProperty('exitCode');
  });

  it('settles when Node throws the start (the agent host down, so it starts here)', async () => {
    const einval = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL', syscall: 'spawn' });
    spawnHere(() => { throw einval; });
    await expect(installDependencies('/wt', '/cache', new AbortController().signal)).rejects.toMatchObject({ code: 'EINVAL', message: 'spawn EINVAL' });
  });

  it('does not start when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(installDependencies('/wt', '/cache', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(hosted.spawnProcess).not.toHaveBeenCalled();
  });
});
