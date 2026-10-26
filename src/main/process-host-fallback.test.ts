/**
 * The real hosts (process-host.ts) when the agent host can't kill an
 * agent's tree: it has given up, so the agent started in the main process,
 * or it doesn't answer. The tree is killed from the main process with
 * taskkill (ps off Windows) in the git host, never waiting for that host.
 *
 * Each test loads its own copy of the hosts, on stand-in utility processes.
 * execa is mocked, so a command run in this process shows up there; the
 * agent is a real process.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { HOST_READY, type HostRequest } from './process-host-protocol.js';
import { TREE_KILL_ANSWER_MS, type HostedProcess } from './process-host-spawn.js';

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
/** Real processes standing in for an agent the agent host started. */
const standIns: ReturnType<typeof spawn>[] = [];

afterEach(() => {
  vi.useRealTimers();
  stopHosts();
  // On Windows the stand-in git host's "taskkill" kills nothing.
  for (const proc of agents.splice(0)) if (proc.pid && proc.exitCode === null && proc.signalCode === null) process.kill(proc.pid);
  for (const child of standIns.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill();
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
    // Started at once: not after the restart, or HOST_WAIT_MS.
    await new Promise((resolve) => setImmediate(resolve));
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
    await new Promise((resolve) => setImmediate(resolve));
    const { file, args } = killCommand(proc.pid!);
    expect(gitHost.sent.map((r) => ({ file: r.file, args: r.args }))).toEqual([{ file, args }]);
    gitHost.emit('exit', 1);

    await expect(killed).resolves.toBe(true);
    expect(mockExeca.mock.calls).toEqual([[file, args, { timeout: 10_000, reject: false }]]);
  });
});

describe('process host: an agent whose agent host stops answering', () => {
  it(`has its tree killed from here, in the git host, by the pid it reported, after ${TREE_KILL_ANSWER_MS / 1000} s with no answer`, async () => {
    vi.resetModules();
    const { utilityProcess } = await import('electron');
    const gitHost = new FakeGitHost();
    const agentHost = Object.assign(new EventEmitter(), {
      pid: 5151, sent: [] as { type?: string; id?: number }[], kill: () => true,
      postMessage(message: { type?: string; id?: number }) { this.sent.push(message); },
    });
    vi.mocked(utilityProcess.fork).mockImplementation(((_script: string, _args: string[], options: { serviceName?: string }) =>
      (options.serviceName === 'Grove agent host' ? agentHost : gitHost)) as never);
    const hosts = await import('./process-host.js');
    stopHosts = hosts.stopProcessHost;
    hosts.startProcessHost();
    gitHost.emit('message', HOST_READY);
    agentHost.emit('message', HOST_READY);

    const proc = hosts.spawnProcess('claude.exe', []);
    const [request] = agentHost.sent;
    // A real process stands in for the agent the host started, so the
    // pid killed by is this test's own.
    const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    standIns.push(agent);
    agentHost.emit('message', { type: 'spawned', id: request.id, pid: agent.pid, launchMs: 5 });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let outcome: boolean | string = 'waiting';
    proc.killTree().then((killed) => { outcome = killed; }, (e: Error) => { outcome = e.message; });
    expect(agentHost.sent).toContainEqual({ type: 'kill-tree', id: request.id });
    await vi.advanceTimersByTimeAsync(TREE_KILL_ANSWER_MS - 1);
    expect(gitHost.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();

    await vi.waitFor(() => expect(outcome).toBe(true));
    const { file, args } = killCommand(agent.pid!);
    expect(gitHost.sent.map((r) => ({ file: r.file, args: r.args, options: r.options }))).toEqual([
      { file, args, options: { timeout: 10_000, reject: false } },
    ]);
  });
});
