/**
 * The real hosts (process-host.ts) once the agent host has given up: an
 * agent starts in the main process, and its tree is killed from there with
 * taskkill (ps off Windows) in the git host, never waiting for that host.
 *
 * Each test loads its own copy of the hosts, on stand-in utility processes.
 * execa is mocked, so a command run in this process shows up there; the
 * agent is a real process.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HOST_READY, type HostRequest } from './process-host-protocol.js';
import type { HostedProcess } from './process-host-spawn.js';

const mockExeca = vi.hoisted(() => vi.fn());
vi.mock('execa', () => ({ execa: mockExeca }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** A stand-in for the git host: keeps what it is sent, and answers each
 *  command as having printed nothing, unless it is to stay quiet (`hold`). */
class FakeGitHost extends EventEmitter {
  readonly pid = 5150;
  sent: HostRequest[] = [];
  hold = false;
  postMessage(message: unknown): void {
    const request = message as HostRequest;
    this.sent.push(request);
    if (this.hold) return;
    queueMicrotask(() => this.emit('message', {
      id: request.id, ok: true, launchMs: 1, result: { stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false },
    }));
  }
  kill(): boolean { return true; }
}

let stopHosts = () => {};
const agents: HostedProcess[] = [];

afterEach(() => {
  stopHosts();
  // On Windows the stand-in git host's "taskkill" kills nothing.
  for (const proc of agents.splice(0)) if (proc.pid && proc.exitCode === null && proc.signalCode === null) process.kill(proc.pid);
  mockExeca.mockReset();
});

/** A fresh copy of the hosts, the git host up and the agent host given up
 *  for good: it failed to start MAX_FAILURES times in a row. */
async function agentHostGaveUp() {
  vi.resetModules();
  const { utilityProcess } = await import('electron');
  const gitHost = new FakeGitHost();
  vi.mocked(utilityProcess.fork).mockImplementation(((_script: string, _args: string[], options: { serviceName?: string }) => {
    if (options.serviceName === 'Grove agent host') throw new Error('no agent host here');
    return gitHost;
  }) as never);
  const hosts = await import('./process-host.js');
  stopHosts = hosts.stopProcessHost;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    hosts.startProcessHost();
    gitHost.emit('message', HOST_READY);
    for (let i = 1; i < hosts.MAX_FAILURES; i++) vi.advanceTimersByTime(hosts.RESTART_DELAY_MS);
  } finally {
    vi.useRealTimers();
  }
  expect(hosts.agentHostGaveUp()).toBe(true);
  const spawnAgent = () => {
    const proc = hosts.spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    agents.push(proc);
    return proc;
  };
  return { gitHost, spawnAgent };
}

/** The command that kills `pid`'s tree: taskkill on Windows, else the ps
 *  that finds it. */
function killCommand(pid: number) {
  return process.platform === 'win32'
    ? { file: expect.stringMatching(/\\System32\\taskkill\.exe$/i) as unknown as string, args: ['/PID', String(pid), '/T', '/F'] }
    : { file: 'ps', args: ['-A', '-o', 'pid=,ppid='] };
}

describe('process host: an agent started in the main process, the agent host given up', () => {
  it('has its tree killed with taskkill (ps off Windows) in the git host', async () => {
    const { gitHost, spawnAgent } = await agentHostGaveUp();
    const proc = spawnAgent();
    // Started here, inside the call.
    expect(proc.pid).toEqual(expect.any(Number));

    await expect(proc.killTree()).resolves.toBe(true);

    const { file, args } = killCommand(proc.pid!);
    expect(gitHost.sent.map((r) => ({ file: r.file, args: r.args, options: r.options }))).toEqual([
      { file, args, options: { timeout: 10_000, reject: false } },
    ]);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('has it killed here at once while the git host restarts, rather than waiting for it', async () => {
    const { gitHost, spawnAgent } = await agentHostGaveUp();
    const proc = spawnAgent();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false });
    // A command asked for now waits for the restart, unless it is urgent.
    gitHost.emit('exit', 1);

    const killed = proc.killTree();
    // Started inside the call: no waiting.
    const { file, args } = killCommand(proc.pid!);
    expect(mockExeca.mock.calls).toEqual([[file, args, { timeout: 10_000, reject: false }]]);
    await expect(killed).resolves.toBe(true);
    expect(gitHost.sent).toEqual([]);
  });

  it('has it killed here when the git host dies running the kill: killing is safe to repeat', async () => {
    const { gitHost, spawnAgent } = await agentHostGaveUp();
    const proc = spawnAgent();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, failed: false, timedOut: false });
    gitHost.hold = true;

    const killed = proc.killTree();
    const { file, args } = killCommand(proc.pid!);
    expect(gitHost.sent.map((r) => ({ file: r.file, args: r.args }))).toEqual([{ file, args }]);
    gitHost.emit('exit', 1);

    await expect(killed).resolves.toBe(true);
    expect(mockExeca.mock.calls).toEqual([[file, args, { timeout: 10_000, reject: false }]]);
  });
});
