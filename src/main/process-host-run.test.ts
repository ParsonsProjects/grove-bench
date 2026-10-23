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
import { recordCommandPids, runInAgentHost } from './process-host-run.js';

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
    expect(hosted.spawnProcess).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'], { cwd: '/repo', shell: true });
  });

  it('gives it the environment execa would', async () => {
    // None: the host's own, as execa's extended environment would be.
    let cmd = nextCommand();
    let done = runInAgentHost('claude', ['mcp', 'list']);
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['mcp', 'list'], {});

    // extendEnv: false: that environment and nothing else.
    const accountEnv = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/me/.claude-work' };
    cmd = nextCommand();
    done = runInAgentHost('claude', ['auth', 'status'], { env: accountEnv, extendEnv: false });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['auth', 'status'], { env: accountEnv });

    // Otherwise added to this one.
    cmd = nextCommand();
    done = runInAgentHost('claude', ['auth', 'status'], { env: { EXTRA: '1' } });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenLastCalledWith('claude', ['auth', 'status'], { env: { ...process.env, EXTRA: '1' } });
  });

  it('finds the command on PATH as execa does when asked (findCommand), for gh.exe with no shell', async () => {
    const cmd = nextCommand();
    const done = runInAgentHost('gh', ['pr', 'view', 'b'], { cwd: '/repo', findCommand: true, timeout: 30_000 });
    cmd.exit(0);
    await done;
    expect(hosted.spawnProcess).toHaveBeenCalledWith('gh', ['pr', 'view', 'b'], { cwd: '/repo', findCommand: true });
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
    expect(hosted.spawnProcessInHost).toHaveBeenCalledWith('typeperf.exe', ['-sc', '1'], {});
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

  it('kills a command that ran out of time before it started once it starts', async () => {
    vi.useFakeTimers();
    const cmd = nextCommand();
    const done = runInAgentHost('claude', ['auth', 'status'], { timeout: 15_000 });
    const failed = done.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failed).toMatchObject({ timedOut: true });
    expect(killTree).not.toHaveBeenCalled();
    cmd.started(77);
    expect(killTree).toHaveBeenCalledWith(77);
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

describe('recordCommandPids', () => {
  // Pids no other test's commands have: a command another test left running
  // is in every recording.
  it('records the pids of the commands it runs, from when they start, until stopped, closed or not', async () => {
    const before = nextCommand();
    const gh = runInAgentHost('gh', ['--version']);
    before.started(71_001);
    const stop = recordCommandPids();

    const during = nextCommand();
    const typeperf = runInAgentHost('typeperf.exe', ['-sc', '1']);
    during.started(71_002);
    during.exit(0);
    await typeperf;
    // One that never starts has no pid.
    const failed = nextCommand();
    const missing = runInAgentHost('nope', []);
    failed.proc.receive({ type: 'error', id: 1, error: { name: 'Error', message: 'spawn nope ENOENT' } });
    failed.exit(null);
    await expect(missing).rejects.toThrow('ENOENT');
    const pids = stop();

    const after = nextCommand();
    const auth = runInAgentHost('gh', ['auth', 'status']);
    after.started(71_003);
    before.exit(0);
    after.exit(0);
    await Promise.all([gh, auth]);

    // Running when it started, and started and closed while it ran: typeperf.
    expect(pids).toContain(71_001);
    expect(pids).toContain(71_002);
    expect(pids).not.toContain(71_003);
    // Once closed, they are in no later recording.
    const later = recordCommandPids()();
    for (const pid of [71_001, 71_002, 71_003]) expect(later).not.toContain(pid);
  });

  it('keeps a pid that a later command has by the time an earlier one with it closes', async () => {
    const first = nextCommand();
    const gh = runInAgentHost('gh', ['pr', 'view']);
    first.started(72_001);
    // It exited, and its pid went to the next, while a process it started
    // held its output open.
    first.exited(0);
    const second = nextCommand();
    const next = runInAgentHost('gh', ['pr', 'checks']);
    second.started(72_001);
    first.exit(0);
    await gh;
    expect(recordCommandPids()()).toContain(72_001);
    second.exit(0);
    await next;
    expect(recordCommandPids()()).not.toContain(72_001);
  });
});
