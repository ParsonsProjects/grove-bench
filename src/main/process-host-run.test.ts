import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HostedProcess } from './process-host-spawn.js';

// The command starts in the agent host (spawnProcess), never here.
const hosted = vi.hoisted(() => ({ spawnProcess: vi.fn(), spawnProcessInHost: vi.fn() }));
vi.mock('./process-host.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnProcess: hosted.spawnProcess,
  spawnProcessInHost: hosted.spawnProcessInHost,
}));
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./process-tree.js', () => ({ killTree: vi.fn(async () => {}) }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { killTree } from './process-tree.js';
import { HOST_STOPPED_MESSAGE } from './process-host.js';
import { runInAgentHost, START_WAIT_MS } from './process-host-run.js';
import { isNetworkError } from './gh.js';

/** The next command spawnProcess starts, driven by the test as the host
 *  would drive it. */
function nextCommand() {
  const proc = new HostedProcess('claude');
  hosted.spawnProcess.mockReturnValueOnce(proc);
  const send = (event: Parameters<HostedProcess['receive']>[0]) => proc.receive(event);
  return {
    proc,
    started: (pid = 4321) => send({ type: 'spawned', id: 1, pid, launchMs: 5 }),
    stdout: (data: string) => send({ type: 'stdout', id: 1, data }),
    stderr: (data: string) => send({ type: 'stderr', id: 1, data }),
    exited: (code: number | null, signal: string | null = null) => send({ type: 'exit', id: 1, code, signal }),
    /** It exits with `code` (or is killed) and its output ends. */
    exit(code: number | null, signal: string | null = null) {
      this.exited(code, signal);
      send({ type: 'close', id: 1 });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hosted.spawnProcess.mockReset();
  hosted.spawnProcessInHost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  // Nothing started in this process.
  expect(execa).not.toHaveBeenCalled();
});

describe('runInAgentHost', () => {
  it('starts the command in the agent host as execa would, and resolves with its output', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['plugin', 'list', '--json'], { cwd: '/repo', shell: true });
    cmd.started();
    cmd.stdout('{"installed":[]');
    cmd.stdout(']}\r\n');
    cmd.stderr('warn\n');
    cmd.exit(0);
    await expect(done).resolves.toMatchObject({ stdout: '{"installed":[]]}', stderr: 'warn', exitCode: 0, failed: false, timedOut: false });
    expect(hosted.spawnProcess).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], { cwd: '/repo', shell: true, agentOutput: false });
  });

  it('gives it the environment execa would', async () => {
    // None: the host's own, as execa's extended environment would be.
    let cmd = nextCommand();
    let done = runInAgentHost('claude', ['mcp', 'list']);
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['mcp', 'list'], { agentOutput: false });

    // extendEnv: false: that environment and nothing else.
    const accountEnv = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/me/.claude-work' };
    cmd = nextCommand();
    done = runInAgentHost('claude', ['auth', 'status'], { env: accountEnv, extendEnv: false });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['auth', 'status'], { env: accountEnv, agentOutput: false });

    // Otherwise added to this one.
    cmd = nextCommand();
    done = runInAgentHost('claude', ['auth', 'status'], { env: { EXTRA: '1' } });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['auth', 'status'], { env: { ...process.env, EXTRA: '1' }, agentOutput: false });
  });

  it('finds the command on PATH as execa does when asked (findCommand), for gh.exe with no shell', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['pr', 'view', 'b'], { cwd: '/repo', findCommand: true, timeout: 30_000 });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('gh', ['pr', 'view', 'b'], { cwd: '/repo', findCommand: true, agentOutput: false });
  });

  it('sends `input` to its stdin and then ends it, as execa does', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['api', '-X', 'POST', 'repos/o/r/pulls/1/reviews', '--input', '-'], { input: '{"event":"APPROVE"}' });
    const sent: unknown[] = [];
    // Until the host has the process, its input waits.
    cmd.proc.connect((command) => sent.push(command));
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'stdin', data: '{"event":"APPROVE"}' }, { type: 'stdin-end' }]));
    cmd.started();
    cmd.stdout('{"html_url":"u"}\n');
    cmd.exit(0);
    await expect(done).resolves.toMatchObject({ stdout: '{"html_url":"u"}' });
  });

  it('leaves stdin alone without `input`', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['auth', 'status']);
    const sent: unknown[] = [];
    cmd.proc.connect((command) => sent.push(command));
    cmd.exit(0);
    await done;
    expect(sent).toEqual([]);
  });

  it('goes by how the process exits when it stops reading its input early (EPIPE), as execa does', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['api', '--input', '-'], { input: 'x'.repeat(10) });
    cmd.started();
    cmd.proc.receive({ type: 'stdin-error', id: 1, error: { name: 'Error', message: 'write EPIPE', code: 'EPIPE' } });
    cmd.stderr('gh: Bad request\n');
    cmd.exit(1);
    await expect(done).rejects.toMatchObject({ exitCode: 1, stderr: 'gh: Bad request' });
  });

  it('starts a host-only command with spawnProcessInHost, which never starts it here', async () => {
    const proc = new HostedProcess('typeperf.exe');
    hosted.spawnProcessInHost.mockReturnValueOnce(proc);
    const done = runInAgentHost('typeperf.exe', ['-sc', '1'], { timeout: 30_000, hostOnly: true });
    expect(hosted.spawnProcessInHost).toHaveBeenCalledWith('typeperf.exe', ['-sc', '1'], { agentOutput: false });
    expect(hosted.spawnProcess).not.toHaveBeenCalled();
    // The agent host isn't up: it didn't start.
    proc.receive({ type: 'error', id: 0, error: { name: 'Error', message: "The agent host isn't running, so typeperf.exe didn't start" } });
    proc.receive({ type: 'close', id: 0 });
    await expect(done).rejects.toThrow("The agent host isn't running, so typeperf.exe didn't start");
  });

  it('rejects as execa did when it exits non-zero', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['plugin', 'install', 'x'], { shell: true });
    cmd.started();
    cmd.stderr('Plugin not found\n');
    cmd.exit(1);
    await expect(done).rejects.toMatchObject({
      message: 'Command failed with exit code 1: claude plugin install x\n\nPlugin not found',
      exitCode: 1,
      stderr: 'Plugin not found',
      failed: true,
      timedOut: false,
    });
  });

  it('rejects with the error that kept it from starting', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { cwd: '/gone' });
    cmd.proc.receive({ type: 'error', id: 1, error: { name: 'Error', message: 'spawn cmd.exe ENOENT', code: 'ENOENT' } });
    cmd.proc.receive({ type: 'close', id: 1 });
    await expect(done).rejects.toMatchObject({ message: 'spawn cmd.exe ENOENT', code: 'ENOENT' });
  });

  it('kills the whole tree when it runs out of time, not just the shell', async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { shell: true, timeout: 60_000 });
    const failed = done.catch((e: unknown) => e);
    cmd.started(4321);
    cmd.stdout('figma: checking');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(killTree).toHaveBeenCalledWith(4321);
    expect(await failed).toMatchObject({ message: expect.stringMatching(/^Command timed out after 60000 milliseconds: claude mcp list/), timedOut: true, stdout: 'figma: checking' });
  });

  it('counts its time limit from its start, not while it waits for the agent host to start or restart', async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    let settled = false;
    const failed = runInAgentHost('gh', ['pr', 'view', 'b'], { findCommand: true, timeout: 30_000 })
      .finally(() => { settled = true; }).catch((e: unknown) => e);
    // The host restarting: longer than spawnProcess itself waits for it.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(settled).toBe(false);
    cmd.started(4321);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    expect(killTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await failed).toMatchObject({ timedOut: true, message: expect.stringMatching(/^Command timed out after 30000 milliseconds: gh pr view b/) });
    expect(killTree).toHaveBeenCalledWith(4321);
  });

  it('runs its time limit at once when it started in this process (the agent host down), as spawn reported before returning', async () => {
    vi.useFakeTimers();
    const proc = new HostedProcess('claude');
    proc.receive({ type: 'spawned', id: 0, pid: 55, launchMs: 1 });
    hosted.spawnProcess.mockReturnValueOnce(proc);
    const failed = runInAgentHost('claude', ['auth', 'status'], { timeout: 15_000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failed).toMatchObject({ timedOut: true });
    expect(killTree).toHaveBeenCalledWith(55);
  });

  it(`stops a command that hasn't started within START_WAIT_MS, and fails it, not as timed out (gh's offline cooldown)`, async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    let settled = false;
    const failed = runInAgentHost('gh', ['pr', 'view', 'b'], { findCommand: true, timeout: 30_000, idempotent: true })
      .finally(() => { settled = true; }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(START_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await failed;
    expect(error).toMatchObject({ message: `Command didn't start within ${START_WAIT_MS / 1000} s: gh pr view b`, timedOut: false, failed: true });
    expect(isNetworkError(error)).toBe(false);
    // Still waiting for the host: it never starts there. Asked to stop, the
    // host would never have it (spawn drops a killed process).
    expect(cmd.proc.killed).toBe(true);
    const sent: unknown[] = [];
    cmd.proc.connect((command) => sent.push(command));
    expect(sent).toEqual([{ type: 'kill', signal: 'SIGTERM' }]);
    // Or, if the host had it already, it is killed with its tree once it
    // has started.
    expect(killTree).not.toHaveBeenCalled();
    cmd.started(88);
    expect(killTree).toHaveBeenCalledWith(88);
    // Its time limit never starts, and it isn't run again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(killTree).toHaveBeenCalledOnce();
    expect(hosted.spawnProcess).toHaveBeenCalledOnce();
  });

  it('rejects at once with the error that kept it from starting, its wait for the start ended', async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['pr', 'view', 'b'], { findCommand: true, timeout: 30_000 });
    cmd.proc.receive({ type: 'error', id: 1, error: { name: 'Error', message: 'spawn gh ENOENT', code: 'ENOENT' } });
    cmd.proc.receive({ type: 'close', id: 1 });
    await expect(done).rejects.toMatchObject({ message: 'spawn gh ENOENT', code: 'ENOENT' });
    expect(vi.getTimerCount()).toBe(0);
    expect(cmd.proc.killed).toBe(false);
  });

  it("doesn't kill by a PID that has exited, which may be another process's by now", async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { shell: true, timeout: 60_000 });
    const failed = done.catch((e: unknown) => e);
    cmd.started(4321);
    // The shell exited, but something it started still holds the output open.
    cmd.exited(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failed).toMatchObject({ timedOut: true });
    expect(killTree).not.toHaveBeenCalled();
  });

  it('runs an idempotent command again once if the host dies under it', async () => {
    const first = nextCommand();
    const second = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { shell: true, idempotent: true });
    first.started();
    first.proc.lost(true);
    await vi.waitFor(() => expect(hosted.spawnProcess).toHaveBeenCalledTimes(2));
    second.started();
    second.stdout('figma: ok\n');
    second.exit(0);
    await expect(done).resolves.toMatchObject({ stdout: 'figma: ok' });
    expect(hosted.spawnProcess.mock.calls[1]).toEqual(hosted.spawnProcess.mock.calls[0]);
  });

  it("doesn't run an idempotent command again when it times out: only when its host dies", async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['pr', 'view', 'b'], { findCommand: true, timeout: 30_000, idempotent: true });
    const failed = done.catch((e: unknown) => e);
    cmd.started(4321);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await failed).toMatchObject({ timedOut: true, message: expect.stringMatching(/^Command timed out after 30000 milliseconds: gh pr view b/) });
    expect(killTree).toHaveBeenCalledWith(4321);
    // Killed, it closes: that is no host dying.
    cmd.exit(null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(hosted.spawnProcess).toHaveBeenCalledOnce();
  });

  it('fails an idempotent command the host dies under twice, rather than run it a third time', async () => {
    const first = nextCommand();
    const second = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { idempotent: true });
    first.proc.lost(true);
    await vi.waitFor(() => expect(hosted.spawnProcess).toHaveBeenCalledTimes(2));
    second.proc.lost(true);
    await expect(done).rejects.toThrow(`${HOST_STOPPED_MESSAGE}: claude mcp list`);
    expect(hosted.spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("doesn't run an idempotent command again when the host is stopped at quit", async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['mcp', 'list'], { idempotent: true });
    cmd.started();
    cmd.proc.lost();
    await expect(done).rejects.toMatchObject({ signal: 'SIGKILL' });
    expect(hosted.spawnProcess).toHaveBeenCalledOnce();
  });

  it('fails a command that is not idempotent if the host dies under it', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['plugin', 'install', 'x'], { shell: true });
    cmd.started();
    cmd.proc.lost(true);
    await expect(done).rejects.toThrow(`${HOST_STOPPED_MESSAGE}: claude plugin install x`);
    expect(hosted.spawnProcess).toHaveBeenCalledOnce();
  });
});
