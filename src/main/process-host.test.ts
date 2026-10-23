import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createProcessHost, isReadOnly, type ProcessHostDeps, DEADLINE_MARGIN_MS, HEALTHY_UPTIME_MS, HOST_START_TIMEOUT_MS, HOST_STOPPED_MESSAGE, HOST_WAIT_MS,
  MAX_FAILURES, RESTART_DELAY_MS, SLOW_HOSTED_LAUNCH_MS, type HostedOptions, type HostProcess,
} from './process-host.js';
import { HOST_READY, type HostReply, type HostRequest, type SpawnEvent, type SpawnRequest, type StdioRequest } from './process-host-protocol.js';
import { createSpawnRunner, type HostedProcess } from './process-host-spawn.js';

/** A stand-in for the utility process: keeps what it was sent. */
class FakeHost extends EventEmitter implements HostProcess {
  pid = 5150;
  sent: HostRequest[] = [];
  killed = false;
  failPost = false;
  postMessage(message: unknown): void {
    if (this.failPost) throw new Error('channel closed');
    this.sent.push(message as HostRequest);
  }
  kill(): boolean { this.killed = true; return true; }
  ready(): void { this.emit('message', HOST_READY); }
  started(id: number, pid: number): void { this.emit('message', { type: 'started', id, pid }); }
  reply(reply: HostReply): void { this.emit('message', reply); }
  exit(code = 1): void { this.emit('exit', code); }
}

/** A host on fake forks and hand-run timers. */
function setup(extra: Partial<ProcessHostDeps> = {}) {
  const hosts: FakeHost[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const notes: string[] = [];
  const killed: number[] = [];
  let t = 0;
  const runHere = vi.fn(async (file: string, args: string[]) => ({ stdout: `here: ${file} ${args.join(' ')}` }));
  /** Spawns started in this process: what each was asked, and how to report back. */
  const local: { requests: (SpawnRequest | StdioRequest)[]; post: (event: SpawnEvent) => void }[] = [];
  const host = createProcessHost({
    fork: () => { const h = new FakeHost(); hosts.push(h); return h; },
    runHere,
    spawnHere: (post) => {
      const runner = { requests: [] as (SpawnRequest | StdioRequest)[], post };
      local.push(runner);
      return { handle: (request) => { runner.requests.push(request); } };
    },
    killPid: (pid) => killed.push(pid),
    now: () => t,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false, unref: () => {} }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) (timer as { cleared: boolean }).cleared = true; },
    note: (line) => notes.push(line),
    ...extra,
  });
  /** Run the pending timers set for `ms`. */
  const fire = (ms: number) => {
    for (const t of timers.filter((x) => x.ms === ms && !x.cleared)) { t.cleared = true; t.fn(); }
  };
  return { host, hosts, runHere, local, notes, killed, fire, advance: (ms: number) => { t += ms; }, latest: () => hosts[hosts.length - 1] };
}

/** What a process reports, in order. */
function watch(proc: HostedProcess) {
  const seen: string[] = [];
  proc.stdout.on('data', (d: Buffer) => seen.push(`out ${d.toString()}`));
  proc.stdout.on('end', () => seen.push('out end'));
  proc.on('exit', (code, signal) => seen.push(`exit ${code} ${signal}`));
  proc.on('close', () => seen.push('close'));
  return seen;
}

/** Let stream events (they come on the next tick) run. */
const settle = () => new Promise((r) => setImmediate(r));

const ok = (id: number, stdout: string, launchMs = 5): HostReply =>
  ({ id, ok: true, launchMs, result: { stdout, stderr: '', exitCode: 0, failed: false, timedOut: false } });

describe('process host', () => {
  it('runs commands in this process, at once, until it is started', async () => {
    const { host, hosts, runHere } = setup();
    const status = host.run('git', ['status']);
    // Before the call returns, as tests that mock execa expect.
    expect(runHere).toHaveBeenCalledWith('git', ['status'], undefined);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    expect(hosts).toEqual([]);
    expect(host.ready).toBe(false);
  });

  it('sends commands to the host once it says it is ready', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    expect(host.ready).toBe(true);

    const result = host.run('git', ['rev-parse', 'HEAD'], { cwd: '/r' });
    expect(latest().sent).toEqual([{ id: 1, file: 'git', args: ['rev-parse', 'HEAD'], options: { cwd: '/r' } }]);
    latest().reply(ok(1, 'abc123'));
    await expect(result).resolves.toMatchObject({ stdout: 'abc123', exitCode: 0 });
    expect(runHere).not.toHaveBeenCalled();
  });

  it('leaves options out of a request that has none', () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    void host.run('git', ['--version']);
    expect(latest().sent[0]).toEqual({ id: 1, file: 'git', args: ['--version'] });
  });

  it('matches replies to requests, whatever order they come back in', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const first = host.run('git', ['status']);
    const second = host.run('gh', ['pr', 'list']);
    latest().reply(ok(2, 'prs'));
    latest().reply(ok(1, 'clean'));
    await expect(first).resolves.toMatchObject({ stdout: 'clean' });
    await expect(second).resolves.toMatchObject({ stdout: 'prs' });
  });

  it('rejects with an error that carries the command\'s output', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const result = host.run('git', ['rev-parse', 'nope']);
    latest().reply({ id: 1, ok: false, launchMs: 3, error: { name: 'ExecaError', message: 'Command failed', stderr: 'fatal: bad revision', exitCode: 128 } });
    await expect(result).rejects.toMatchObject({ message: 'Command failed', stderr: 'fatal: bad revision', exitCode: 128 });
    await expect(result).rejects.toBeInstanceOf(Error);
  });

  it('ignores messages that are not replies, and replies to nothing it sent', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const result = host.run('git', ['status']);
    latest().emit('message', { id: 1, junk: true });
    latest().reply(ok(99, 'stray'));
    latest().reply(ok(1, 'real'));
    await expect(result).resolves.toMatchObject({ stdout: 'real' });
  });

  it('notes a slow launch the host absorbed', async () => {
    const { host, notes, latest } = setup();
    host.start();
    latest().ready();
    const fast = host.run('git', ['status']);
    latest().reply(ok(1, '', SLOW_HOSTED_LAUNCH_MS - 1));
    await fast;
    expect(notes).toEqual([]);

    const slow = host.run('gh', ['pr', 'view']);
    latest().reply(ok(2, '', 20_009));
    await slow;
    expect(notes).toEqual(['gh pr took 20009 ms to start, in the process host (the window kept responding)']);
  });

  it('runs a command here when it cannot be sent', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    latest().failPost = true;
    await expect(host.run('git', ['status'])).resolves.toEqual({ stdout: 'here: git status' });
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('runs a host-only command in the host, and never here', async () => {
    const { host, runHere, latest } = setup();
    await expect(host.runInHost('typeperf', ['-sc', '1'])).rejects.toThrow("The process host isn't running, so typeperf didn't run");
    host.start();
    // Asked for while the host starts: it waits for it.
    const early = host.runInHost('typeperf', ['-sc', '1']);
    expect(latest().sent).toEqual([]);

    latest().ready();
    const listed = host.runInHost('typeperf', ['-sc', '1'], { timeout: 30_000 });
    expect(latest().sent).toEqual([
      { id: 1, file: 'typeperf', args: ['-sc', '1'] },
      { id: 2, file: 'typeperf', args: ['-sc', '1'], options: { timeout: 30_000 } },
    ]);
    latest().reply(ok(1, 'early'));
    latest().reply(ok(2, 'sample'));
    await expect(early).resolves.toMatchObject({ stdout: 'early' });
    await expect(listed).resolves.toMatchObject({ stdout: 'sample' });

    latest().failPost = true;
    await expect(host.runInHost('typeperf', ['-sc', '1'])).rejects.toThrow("isn't running");
    expect(runHere).not.toHaveBeenCalled();
  });

  it('fails a host-only command when the host dies, even one that only reads or is idempotent', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    const status = host.runInHost('git', ['status']);
    const list = host.runInHost('typeperf', ['-sc', '1'], { idempotent: true });
    latest().exit(1);
    await expect(status).rejects.toThrow(HOST_STOPPED_MESSAGE);
    await expect(list).rejects.toThrow(HOST_STOPPED_MESSAGE);
    expect(runHere).not.toHaveBeenCalled();
  });

  it("knows the host's process id only while it is up", () => {
    const { host, latest } = setup();
    expect(host.pid).toBeUndefined();
    host.start();
    expect(host.pid).toBeUndefined();
    latest().ready();
    expect(host.pid).toBe(5150);
    latest().exit(1);
    expect(host.pid).toBeUndefined();
  });

  it('fails the commands in flight when the host exits, then starts it again', async () => {
    const { host, hosts, notes, fire, latest } = setup();
    host.start();
    latest().ready();
    const inFlight = host.run('git', ['commit', '-m', 'x']);
    latest().exit(3);

    await expect(inFlight).rejects.toThrow(`${HOST_STOPPED_MESSAGE}: git commit`);
    expect(host.ready).toBe(false);
    expect(notes).toEqual(['process host exited with code 3; starting it again']);

    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
    latest().ready();
    expect(host.ready).toBe(true);
  });

  it(`gives up after ${MAX_FAILURES} failures and runs everything here`, async () => {
    const { host, hosts, notes, runHere, fire, latest } = setup();
    host.start();
    for (let i = 0; i < MAX_FAILURES; i++) {
      latest().ready();
      latest().exit(1);
      fire(RESTART_DELAY_MS);
    }
    expect(hosts).toHaveLength(MAX_FAILURES);
    expect(notes.at(-1)).toBe('process host exited with code 1; git commands run in the main process from now on');
    await host.run('git', ['status']);
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('kills a host that never says it is ready, and counts it as a failure', () => {
    const { host, hosts, notes, fire, latest } = setup();
    host.start();
    const first = latest();
    fire(HOST_START_TIMEOUT_MS);
    expect(first.killed).toBe(true);
    expect(notes).toEqual([`process host didn't start within ${HOST_START_TIMEOUT_MS / 1000} s; starting it again`]);

    // Its exit and a late ready are about the old process: ignored.
    first.exit(1);
    first.ready();
    expect(host.ready).toBe(false);
    expect(notes).toHaveLength(1);

    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
  });

  it('counts a fork that throws as a failure', () => {
    const notes: string[] = [];
    const host = createProcessHost({
      fork: () => { throw new Error('no utility process'); },
      runHere: async () => ({}),
      setTimer: () => ({}),
      clearTimer: () => {},
      note: (line) => notes.push(line),
    });
    host.start();
    expect(notes).toEqual(["process host couldn't start: no utility process; starting it again"]);
  });

  it('stops for good: fails what is in flight, kills it, and runs later commands here', async () => {
    const { host, hosts, notes, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const inFlight = host.run('git', ['fetch']);
    host.stop();

    await expect(inFlight).rejects.toThrow(HOST_STOPPED_MESSAGE);
    expect(latest().killed).toBe(true);
    latest().exit(0);
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(1);
    expect(notes).toEqual([]);

    await host.run('git', ['status']);
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('starts only once', () => {
    const { host, hosts } = setup();
    host.start();
    host.start();
    expect(hosts).toHaveLength(1);
  });

  it('stops the processes the host started when it dies, and runs read-only ones again once it has restarted', async () => {
    const { host, runHere, killed, fire, latest } = setup();
    host.start();
    latest().ready();
    const status = host.run('git', ['status', '--porcelain'], { cwd: '/r' });
    const commit = host.run('git', ['commit', '-m', 'x'], { cwd: '/r' });
    latest().started(1, 4242);
    latest().started(2, 4343);
    latest().exit(1);

    expect(killed).toEqual([4242, 4343]);
    await expect(commit).rejects.toThrow(HOST_STOPPED_MESSAGE);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 3, file: 'git', args: ['status', '--porcelain'], options: { cwd: '/r' } }]);
    latest().reply(ok(3, 'clean'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it('stops and fails every command in flight at quit, read-only or not', async () => {
    const { host, runHere, killed, latest } = setup();
    host.start();
    latest().ready();
    const version = host.run('git', ['--version']);
    latest().started(1, 77);
    host.stop();
    await expect(version).rejects.toThrow(HOST_STOPPED_MESSAGE);
    expect(killed).toEqual([77]);
    expect(runHere).not.toHaveBeenCalled();
  });

  it('keeps the caller\'s stack on errors', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const result = (function askedFromHere() { return host.run('git', ['rev-parse', 'nope']); })();
    latest().reply({ id: 1, ok: false, launchMs: 1, error: { name: 'ExecaError', message: 'Command failed', stack: 'ExecaError: Command failed\n    at hostInternals (execa.js:1:1)' } });
    const error = await result.then(() => null, (e: Error) => e);
    expect(error?.stack).toMatch(/^ExecaError: Command failed\n/);
    expect(error?.stack).toContain('askedFromHere');
    expect(error?.stack).not.toContain('hostInternals');
  });

  it('fails a command the host never answers as timed out, and restarts the host', async () => {
    const { host, hosts, notes, fire, latest } = setup();
    host.start();
    latest().ready();
    const first = latest();
    const result = host.run('gh', ['pr', 'list'], { cwd: '/r', timeout: 30_000 });
    fire(30_000 + DEADLINE_MARGIN_MS);

    await expect(result).rejects.toMatchObject({ timedOut: true, message: expect.stringContaining('gh pr got no answer') });
    expect(first.killed).toBe(true);
    expect(notes).toEqual(['process host stopped answering (gh pr); restarting it']);
    first.exit(15);
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
  });

  it('takes no more commands once it has been killed for not answering, until it has restarted', async () => {
    const { host, hosts, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const first = latest();
    const result = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(result).rejects.toMatchObject({ timedOut: true });
    expect(first.killed).toBe(true);
    expect(host.ready).toBe(false);
    expect(host.pid).toBeUndefined();

    // Until its exit comes, the dying host is still `host`: a retry posted
    // there would only fail with it. It waits for the new host instead.
    const retry = host.run('git', ['commit', '-m', 'x'], { cwd: '/r' });
    expect(first.sent).toHaveLength(1);

    first.exit(15);
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
    latest().ready();
    void host.run('git', ['status']);
    expect(latest().sent).toEqual([
      { id: 2, file: 'git', args: ['commit', '-m', 'x'], options: { cwd: '/r' } },
      { id: 3, file: 'git', args: ['status'] },
    ]);
    latest().reply(ok(2, 'committed'));
    await expect(retry).resolves.toMatchObject({ stdout: 'committed' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it('runs an idempotent command again here when the host stops answering under it, once', async () => {
    const { host, hosts, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const first = latest();
    const taskkill = 'C:\\Windows\\System32\\taskkill.exe';
    const killed = host.run(taskkill, ['/PID', '4242', '/T', '/F'], { timeout: 10_000, reject: false, idempotent: true });
    // A command already waiting on the hung host, and one asked for after.
    const other = host.run('git', ['status'], { cwd: '/r' });
    fire(10_000 + DEADLINE_MARGIN_MS);

    // The kill still happens, here, with the options execa takes.
    await expect(killed).resolves.toEqual({ stdout: `here: ${taskkill} /PID 4242 /T /F` });
    expect(runHere).toHaveBeenCalledWith(taskkill, ['/PID', '4242', '/T', '/F'], { timeout: 10_000, reject: false });
    expect(first.killed).toBe(true);
    // One asked for now waits for the host that replaces it.
    const next = host.run(taskkill, ['/PID', '7', '/T', '/F'], { timeout: 10_000, reject: false, idempotent: true });
    expect(first.sent).toHaveLength(2);

    // The host's exit sends what was waiting on it to wait for the restart,
    // ahead of the one asked for since; the kill doesn't run again.
    first.exit(15);
    expect(runHere.mock.calls.map(([, args]) => args[1])).toEqual(['4242']);
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
    latest().ready();
    expect(latest().sent).toEqual([
      { id: 3, file: 'git', args: ['status'], options: { cwd: '/r' } },
      { id: 4, file: taskkill, args: ['/PID', '7', '/T', '/F'], options: { timeout: 10_000, reject: false } },
    ]);
    latest().reply(ok(3, 'clean'));
    latest().reply(ok(4, ''));
    await expect(other).resolves.toMatchObject({ stdout: 'clean' });
    await expect(next).resolves.toMatchObject({ exitCode: 0 });
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('runs an idempotent command again once the host has restarted, and still fails one that is not', async () => {
    const { host, runHere, killed, fire, latest } = setup();
    host.start();
    latest().ready();
    const lookup = host.run('where.exe', ['claude'], { timeout: 10_000, idempotent: true });
    const editor = host.run('code', ['-g', '/r/a.ts:7']);
    latest().started(1, 4242);
    latest().exit(1);

    expect(killed).toEqual([4242]);
    await expect(editor).rejects.toThrow(`${HOST_STOPPED_MESSAGE}: code`);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 3, file: 'where.exe', args: ['claude'], options: { timeout: 10_000 } }]);
    latest().reply(ok(3, 'C:\\bin\\claude.exe'));
    await expect(lookup).resolves.toMatchObject({ stdout: 'C:\\bin\\claude.exe' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it('runs an idempotent command again here at quit, unlike a read-only one', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    const kill = host.run('taskkill.exe', ['/PID', '4242', '/T', '/F'], { reject: false, idempotent: true });
    const version = host.run('git', ['--version']);
    host.stop();
    await expect(kill).resolves.toEqual({ stdout: 'here: taskkill.exe /PID 4242 /T /F' });
    await expect(version).rejects.toThrow(HOST_STOPPED_MESSAGE);
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('never sends idempotent or urgent to the host, or to execa', async () => {
    const { host, runHere, fire, latest } = setup();
    await host.run('ps', ['-A'], { timeout: 10_000, idempotent: true, urgent: true });
    expect(runHere).toHaveBeenLastCalledWith('ps', ['-A'], { timeout: 10_000 });
    host.start();
    latest().ready();
    void host.run('ps', ['-A'], { timeout: 10_000, idempotent: true, urgent: true });
    expect(latest().sent).toEqual([{ id: 1, file: 'ps', args: ['-A'], options: { timeout: 10_000 } }]);
    // Nor when it runs again, here or in the next host.
    void host.run('git', ['status'], { idempotent: true });
    latest().exit(1);
    expect(runHere).toHaveBeenCalledTimes(2);
    expect(runHere).toHaveBeenLastCalledWith('ps', ['-A'], { timeout: 10_000 });
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 3, file: 'git', args: ['status'], options: {} }]);
  });

  it('gives a command its time again when its deadline comes late, as after sleep', async () => {
    const { host, hosts, notes, fire, advance, latest } = setup();
    host.start();
    latest().ready();
    const first = latest();
    const result = host.run('gh', ['pr', 'list'], { cwd: '/r', timeout: 30_000 });

    // The computer slept 11 minutes; the timer runs the moment it wakes.
    advance(11 * 60_000);
    fire(30_000 + DEADLINE_MARGIN_MS);
    expect(first.killed).toBe(false);
    expect(notes).toEqual([]);

    // The host answers soon after: execa's own timeout ran on waking too.
    first.reply({ id: 1, ok: false, launchMs: 5, error: { name: 'ExecaError', message: 'Command timed out', timedOut: true } });
    await expect(result).rejects.toMatchObject({ timedOut: true, message: 'Command timed out' });
    expect(hosts).toHaveLength(1);
  });

  it('still restarts a host that stays silent through the second deadline', async () => {
    const { host, notes, fire, advance, latest } = setup();
    host.start();
    latest().ready();
    const result = host.run('gh', ['pr', 'list'], { cwd: '/r', timeout: 30_000 });
    advance(11 * 60_000);
    fire(30_000 + DEADLINE_MARGIN_MS);

    advance(30_000 + DEADLINE_MARGIN_MS);
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(result).rejects.toMatchObject({ timedOut: true });
    expect(latest().killed).toBe(true);
    expect(notes).toEqual(['process host stopped answering (gh pr); restarting it']);
  });

  it('clears the deadline once the command is answered', async () => {
    const { host, notes, fire, latest } = setup();
    host.start();
    latest().ready();
    const result = host.run('git', ['fetch'], { cwd: '/r', timeout: 30_000 });
    latest().reply(ok(1, ''));
    await result;
    fire(30_000 + DEADLINE_MARGIN_MS);
    expect(latest().killed).toBe(false);
    expect(notes).toEqual([]);
  });

  it('starts counting failures again after the host has run well for a while', () => {
    const { host, hosts, notes, fire, advance, latest } = setup();
    host.start();
    for (let i = 0; i < MAX_FAILURES + 2; i++) {
      latest().ready();
      advance(HEALTHY_UPTIME_MS);
      latest().exit(1);
      fire(RESTART_DELAY_MS);
    }
    expect(hosts).toHaveLength(MAX_FAILURES + 3);
    expect(notes.every((n) => n.endsWith('starting it again'))).toBe(true);
  });

  it('notes a fatal error, then handles the exit that follows', () => {
    const { host, notes, latest } = setup();
    host.start();
    latest().ready();
    latest().emit('error', 'FatalError', 'v8', 'report');
    latest().exit(134);
    expect(notes).toEqual(['process host hit a fatal error (FatalError)', 'process host exited with code 134; starting it again']);
    expect(host.ready).toBe(false);
  });
});

describe('process host: commands asked for while it starts', () => {
  it('wait for it, then run there in the order they were asked for, none here', async () => {
    const { host, runHere, notes, advance, latest } = setup();
    host.start();
    const head = host.run('git', ['rev-parse', 'HEAD'], { cwd: '/r' });
    const list = host.run('git', ['worktree', 'list', '--porcelain'], { cwd: '/r' });
    const prs = host.run('gh', ['pr', 'list'], { cwd: '/r', timeout: 30_000 });
    expect(latest().sent).toEqual([]);
    expect(runHere).not.toHaveBeenCalled();

    advance(420);
    latest().ready();
    // One asked for once it is up goes after them.
    void host.run('git', ['status']);
    expect(latest().sent).toEqual([
      { id: 1, file: 'git', args: ['rev-parse', 'HEAD'], options: { cwd: '/r' } },
      { id: 2, file: 'git', args: ['worktree', 'list', '--porcelain'], options: { cwd: '/r' } },
      { id: 3, file: 'gh', args: ['pr', 'list'], options: { cwd: '/r', timeout: 30_000 } },
      { id: 4, file: 'git', args: ['status'] },
    ]);
    latest().reply(ok(3, 'prs'));
    latest().reply(ok(1, 'abc123'));
    latest().reply(ok(2, 'worktrees'));
    await expect(head).resolves.toMatchObject({ stdout: 'abc123' });
    await expect(list).resolves.toMatchObject({ stdout: 'worktrees' });
    await expect(prs).resolves.toMatchObject({ stdout: 'prs' });
    expect(runHere).not.toHaveBeenCalled();
    expect(notes).toEqual(['process host up in 420 ms; 3 commands waited for it']);
  });

  it(`run here, in order, once they have waited ${HOST_WAIT_MS / 1000} s, as do the next until the host is up`, async () => {
    const { host, runHere, notes, fire, latest } = setup();
    host.start();
    const first = host.run('git', ['rev-parse', '--git-dir'], { cwd: '/a' });
    const second = host.run('git', ['status'], { cwd: '/b', timeout: 10_000 });
    fire(HOST_WAIT_MS);

    expect(runHere.mock.calls).toEqual([
      ['git', ['rev-parse', '--git-dir'], { cwd: '/a' }],
      ['git', ['status'], { cwd: '/b', timeout: 10_000 }],
    ]);
    await expect(first).resolves.toEqual({ stdout: 'here: git rev-parse --git-dir' });
    await expect(second).resolves.toEqual({ stdout: 'here: git status' });
    expect(notes).toEqual([`process host wasn't up after ${HOST_WAIT_MS / 1000} s; 2 commands that waited for it, and those after them until it is, run in the main process`]);

    // The start is slow: the next don't wait for it too.
    await expect(host.run('git', ['log'])).resolves.toEqual({ stdout: 'here: git log' });
    expect(runHere).toHaveBeenCalledTimes(3);

    // Once it is up, commands go there again.
    latest().ready();
    void host.run('git', ['diff']);
    expect(latest().sent).toEqual([{ id: 1, file: 'git', args: ['diff'] }]);
    expect(runHere).toHaveBeenCalledTimes(3);
  });

  it('run here when the start fails, and the next wait for the restart', async () => {
    const { host, hosts, runHere, fire, latest } = setup();
    host.start();
    const status = host.run('git', ['status']);
    latest().exit(1);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });

    // The restart is a new start: commands wait for it.
    const log = host.run('git', ['log']);
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
    const diff = host.run('git', ['diff']);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 1, file: 'git', args: ['log'] }, { id: 2, file: 'git', args: ['diff'] }]);
    latest().reply(ok(1, 'log'));
    latest().reply(ok(2, 'diff'));
    await expect(log).resolves.toMatchObject({ stdout: 'log' });
    await expect(diff).resolves.toMatchObject({ stdout: 'diff' });
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('run here when the host never says it is ready', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    const first = latest();
    const status = host.run('git', ['status']);
    fire(HOST_START_TIMEOUT_MS);
    expect(first.killed).toBe(true);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    expect(first.sent).toEqual([]);
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('wait through a restart after a crash, for the new host', async () => {
    const { host, hosts, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    latest().exit(1);

    const status = host.run('git', ['status'], { cwd: '/r' });
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(2);
    const log = host.run('git', ['log'], { cwd: '/r' });
    expect(latest().sent).toEqual([]);
    latest().ready();
    expect(latest().sent).toEqual([
      { id: 1, file: 'git', args: ['status'], options: { cwd: '/r' } },
      { id: 2, file: 'git', args: ['log'], options: { cwd: '/r' } },
    ]);
    latest().reply(ok(1, 'clean'));
    latest().reply(ok(2, 'history'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    await expect(log).resolves.toMatchObject({ stdout: 'history' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it(`run here when a restart takes longer than ${HOST_WAIT_MS / 1000} s`, async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    latest().exit(1);
    const status = host.run('git', ['status']);
    fire(HOST_WAIT_MS);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('wait for a killed host until its exit, and run here if the exit never comes', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const hung = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(hung).rejects.toMatchObject({ timedOut: true });
    expect(latest().killed).toBe(true);

    const status = host.run('git', ['status']);
    expect(runHere).not.toHaveBeenCalled();
    fire(HOST_WAIT_MS);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    await expect(host.run('git', ['log'])).resolves.toEqual({ stdout: 'here: git log' });
  });

  it('a host-only command waits too, and fails rather than run here when the host is not up in time', async () => {
    const slow = setup();
    slow.host.start();
    const listed = slow.host.runInHost('typeperf', ['-sc', '1']);
    slow.fire(HOST_WAIT_MS);
    await expect(listed).rejects.toThrow("The process host isn't running, so typeperf didn't run");

    const broken = setup();
    broken.host.start();
    const next = broken.host.runInHost('typeperf', ['-sc', '1']);
    broken.latest().exit(1);
    await expect(next).rejects.toThrow("isn't running");

    expect(slow.runHere).not.toHaveBeenCalled();
    expect(broken.runHere).not.toHaveBeenCalled();
  });

  it('keeps the caller\'s stack on a host-only command that waited in vain', async () => {
    const { host, fire } = setup();
    host.start();
    const result = (function askedFromHere() { return host.runInHost('typeperf', ['-sc', '1']); })();
    fire(HOST_WAIT_MS);
    const error = await result.then(() => null, (e: Error) => e);
    expect(error?.stack).toContain('askedFromHere');
  });

  it(`run here once the host gives up after ${MAX_FAILURES} failures`, async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      latest().exit(1);
      fire(RESTART_DELAY_MS);
    }
    const status = host.run('git', ['status']);
    latest().exit(1);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    await host.run('git', ['log']);
    expect(runHere).toHaveBeenCalledTimes(2);
  });

  it('run here at quit, never having been sent, as later ones do (a host-only one fails)', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    latest().exit(1);
    const commit = host.run('git', ['commit', '-m', 'x']);
    const listed = host.runInHost('typeperf', ['-sc', '1']);
    host.stop();
    await expect(commit).resolves.toEqual({ stdout: 'here: git commit -m x' });
    await expect(listed).rejects.toThrow("isn't running");
    await host.run('git', ['status']);
    expect(runHere).toHaveBeenCalledTimes(2);
  });

  it('get their deadline when sent, not while they wait, and still time out', async () => {
    const { host, notes, fire, latest } = setup();
    host.start();
    const prs = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    // No deadline runs while it waits: nothing happens.
    fire(30_000 + DEADLINE_MARGIN_MS);
    expect(latest().killed).toBe(false);

    latest().ready();
    expect(latest().sent).toEqual([{ id: 1, file: 'gh', args: ['pr', 'list'], options: { timeout: 30_000 } }]);
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(prs).rejects.toMatchObject({ timedOut: true, message: expect.stringContaining('gh pr got no answer') });
    expect(latest().killed).toBe(true);
    expect(notes.at(-1)).toBe('process host stopped answering (gh pr); restarting it');
  });

  it('are in flight like any other once sent: a host that dies sends read-only ones back to wait, and fails the rest', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    const status = host.run('git', ['status']);
    const commit = host.run('git', ['commit', '-m', 'x']);
    latest().ready();
    latest().exit(1);
    await expect(commit).rejects.toThrow(`${HOST_STOPPED_MESSAGE}: git commit`);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 3, file: 'git', args: ['status'] }]);
    latest().reply(ok(3, 'clean'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it('run here when the host is up but they cannot be sent', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    const status = host.run('git', ['status']);
    latest().failPost = true;
    latest().ready();
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    expect(runHere).toHaveBeenCalledTimes(1);
  });
});

describe('process host: commands safe to repeat, in flight when it dies', () => {
  it('wait for the restart, in the order asked for and ahead of those asked for since, none here', async () => {
    const { host, runHere, killed, notes, fire, latest } = setup();
    host.start();
    latest().ready();
    // At launch: the restore's commands in flight.
    const head = host.run('git', ['rev-parse', 'HEAD'], { cwd: '/a' });
    const lookup = host.run('where.exe', ['claude'], { timeout: 10_000, idempotent: true });
    const status = host.run('git', ['status'], { cwd: '/b', timeout: 10_000 });
    latest().started(1, 101);
    latest().started(3, 103);
    latest().exit(1);
    // Their processes are stopped, as before.
    expect(killed).toEqual([101, 103]);

    const log = host.run('git', ['log'], { cwd: '/a' });
    fire(RESTART_DELAY_MS);
    const diff = host.run('git', ['diff'], { cwd: '/a' });
    expect(latest().sent).toEqual([]);
    latest().ready();
    expect(latest().sent).toEqual([
      { id: 4, file: 'git', args: ['rev-parse', 'HEAD'], options: { cwd: '/a' } },
      { id: 5, file: 'where.exe', args: ['claude'], options: { timeout: 10_000 } },
      { id: 6, file: 'git', args: ['status'], options: { cwd: '/b', timeout: 10_000 } },
      { id: 7, file: 'git', args: ['log'], options: { cwd: '/a' } },
      { id: 8, file: 'git', args: ['diff'], options: { cwd: '/a' } },
    ]);
    expect(notes.at(-1)).toBe('process host up in 0 ms; 5 commands waited for it');
    latest().reply(ok(6, 'clean'));
    latest().reply(ok(4, 'abc123'));
    latest().reply(ok(5, 'C:\\bin\\claude.exe'));
    latest().reply(ok(7, 'history'));
    latest().reply(ok(8, 'changes'));
    await expect(head).resolves.toMatchObject({ stdout: 'abc123' });
    await expect(lookup).resolves.toMatchObject({ stdout: 'C:\\bin\\claude.exe' });
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    await expect(log).resolves.toMatchObject({ stdout: 'history' });
    await expect(diff).resolves.toMatchObject({ stdout: 'changes' });
    expect(runHere).not.toHaveBeenCalled();
    // Their old processes aren't stopped again.
    expect(killed).toEqual([101, 103]);
  });

  it('go ahead of those that waited for a host killed for not answering', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const hung = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    const status = host.run('git', ['status']);
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(hung).rejects.toMatchObject({ timedOut: true });
    // Asked for while the killed host is still going: it waits.
    const log = host.run('git', ['log']);
    latest().exit(15);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([
      { id: 3, file: 'git', args: ['status'] },
      { id: 4, file: 'git', args: ['log'] },
    ]);
    latest().reply(ok(3, 'clean'));
    latest().reply(ok(4, 'history'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    await expect(log).resolves.toMatchObject({ stdout: 'history' });
    expect(runHere).not.toHaveBeenCalled();
  });

  it(`run here, in order, when the restart takes longer than ${HOST_WAIT_MS / 1000} s`, async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const status = host.run('git', ['status'], { cwd: '/r' });
    const lookup = host.run('where.exe', ['claude'], { idempotent: true });
    latest().exit(1);
    const log = host.run('git', ['log'], { cwd: '/r' });
    expect(runHere).not.toHaveBeenCalled();

    fire(HOST_WAIT_MS);
    expect(runHere.mock.calls).toEqual([
      ['git', ['status'], { cwd: '/r' }],
      ['where.exe', ['claude'], {}],
      ['git', ['log'], { cwd: '/r' }],
    ]);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    await expect(lookup).resolves.toEqual({ stdout: 'here: where.exe claude' });
    await expect(log).resolves.toEqual({ stdout: 'here: git log' });
  });

  it('run here when the restart fails', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    const status = host.run('git', ['status']);
    latest().exit(1);
    fire(RESTART_DELAY_MS);
    expect(runHere).not.toHaveBeenCalled();
    // The new host dies before it is up.
    latest().exit(1);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    expect(latest().sent).toEqual([]);
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('run here if the next host dies running them too: they may be what kills it', async () => {
    const { host, hosts, runHere, killed, fire, latest } = setup();
    host.start();
    latest().ready();
    const diff = host.run('git', ['diff'], { cwd: '/r' });
    latest().started(1, 101);
    latest().exit(1);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 2, file: 'git', args: ['diff'], options: { cwd: '/r' } }]);

    latest().exit(1);
    await expect(diff).resolves.toEqual({ stdout: 'here: git diff' });
    expect(runHere).toHaveBeenCalledTimes(1);
    // The first host's process isn't stopped twice: its pid may be another's by now.
    expect(killed).toEqual([101]);
    // The host itself still restarts.
    fire(RESTART_DELAY_MS);
    expect(hosts).toHaveLength(3);
  });

  it(`run here, ahead of those waiting, once the host gives up after ${MAX_FAILURES} failures`, async () => {
    const { host, runHere, notes, fire, latest } = setup();
    host.start();
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      latest().ready();
      latest().exit(1);
      fire(RESTART_DELAY_MS);
    }
    latest().ready();
    const hung = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    const status = host.run('git', ['status']);
    const kill = host.run('taskkill.exe', ['/PID', '4242', '/T', '/F'], { reject: false, idempotent: true });
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(hung).rejects.toMatchObject({ timedOut: true });
    const log = host.run('git', ['log']);
    expect(runHere).not.toHaveBeenCalled();

    latest().exit(15);
    expect(notes.at(-1)).toBe('process host exited with code 15; git commands run in the main process from now on');
    expect(runHere.mock.calls.map(([file, args]) => `${file} ${args[0]}`)).toEqual(['git status', 'taskkill.exe /PID', 'git log']);
    await expect(status).resolves.toEqual({ stdout: 'here: git status' });
    await expect(kill).resolves.toEqual({ stdout: 'here: taskkill.exe /PID 4242 /T /F' });
    await expect(log).resolves.toEqual({ stdout: 'here: git log' });
  });

  it('run here at quit if idempotent, ahead of those waiting; read-only ones fail', async () => {
    const { host, runHere, killed, fire, latest } = setup();
    host.start();
    latest().ready();
    const hung = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    const kill = host.run('taskkill.exe', ['/PID', '4242', '/T', '/F'], { reject: false, idempotent: true });
    const status = host.run('git', ['status']);
    latest().started(2, 202);
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(hung).rejects.toMatchObject({ timedOut: true });
    const commit = host.run('git', ['commit', '-m', 'x']);

    host.stop();
    expect(killed).toEqual([202]);
    expect(runHere.mock.calls.map(([file]) => file)).toEqual(['taskkill.exe', 'git']);
    await expect(kill).resolves.toEqual({ stdout: 'here: taskkill.exe /PID 4242 /T /F' });
    await expect(status).rejects.toThrow(HOST_STOPPED_MESSAGE);
    await expect(commit).resolves.toEqual({ stdout: 'here: git commit -m x' });
    // Nothing is left waiting.
    fire(HOST_WAIT_MS);
    expect(runHere).toHaveBeenCalledTimes(2);
  });
});

describe('process host: urgent commands', () => {
  const taskkill = 'C:\\Windows\\System32\\taskkill.exe';
  const kill = ['/PID', '4242', '/T', '/F'];

  it('run here at once while the host restarts, while one that is not urgent still waits', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    latest().ready();
    latest().exit(1);

    const status = host.run('git', ['status']);
    const killed = host.run(taskkill, kill, { timeout: 10_000, reject: false, idempotent: true, urgent: true });
    // Before the call returns, with only the options execa takes.
    expect(runHere.mock.calls).toEqual([[taskkill, kill, { timeout: 10_000, reject: false }]]);
    await expect(killed).resolves.toEqual({ stdout: `here: ${taskkill} ${kill.join(' ')}` });

    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 1, file: 'git', args: ['status'] }]);
    latest().reply(ok(1, 'clean'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
    expect(runHere).toHaveBeenCalledTimes(1);
  });

  it('run here at once while the host starts, or is killed for not answering', async () => {
    const { host, runHere, fire, latest } = setup();
    host.start();
    void host.run(taskkill, kill, { idempotent: true, urgent: true });
    expect(runHere).toHaveBeenCalledTimes(1);

    latest().ready();
    const hung = host.run('gh', ['pr', 'list'], { timeout: 30_000 });
    fire(30_000 + DEADLINE_MARGIN_MS);
    await expect(hung).rejects.toMatchObject({ timedOut: true });
    void host.run(taskkill, kill, { idempotent: true, urgent: true });
    expect(runHere).toHaveBeenCalledTimes(2);
    expect(latest().sent).toEqual([{ id: 1, file: 'gh', args: ['pr', 'list'], options: { timeout: 30_000 } }]);
  });

  it('go to the host when it is up', () => {
    const { host, runHere, latest } = setup();
    host.start();
    latest().ready();
    void host.run(taskkill, kill, { reject: false, idempotent: true, urgent: true });
    expect(latest().sent).toEqual([{ id: 1, file: taskkill, args: kill, options: { reject: false } }]);
    expect(runHere).not.toHaveBeenCalled();
  });

  it('run again here at once when the host dies under them, rather than wait for the restart', async () => {
    const { host, runHere, killed, fire, latest } = setup();
    host.start();
    latest().ready();
    const status = host.run('git', ['status']);
    const killing = host.run(taskkill, kill, { reject: false, idempotent: true, urgent: true });
    latest().started(2, 900);
    latest().exit(1);

    expect(killed).toEqual([900]);
    expect(runHere.mock.calls).toEqual([[taskkill, kill, { reject: false }]]);
    await expect(killing).resolves.toEqual({ stdout: `here: ${taskkill} ${kill.join(' ')}` });
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(latest().sent).toEqual([{ id: 3, file: 'git', args: ['status'] }]);
    latest().reply(ok(3, 'clean'));
    await expect(status).resolves.toMatchObject({ stdout: 'clean' });
  });

  it('host-only, are refused at once rather than wait', async () => {
    const { host, runHere, latest } = setup();
    host.start();
    await expect(host.runInHost('typeperf', ['-sc', '1'], { urgent: true })).rejects.toThrow("The process host isn't running, so typeperf didn't run");
    expect(latest().sent).toEqual([]);
    expect(runHere).not.toHaveBeenCalled();
  });
});

describe('process host: every way a command runs here settles it alike', () => {
  type Setup = ReturnType<typeof setup>;
  const up = (s: Setup) => { s.host.start(); s.latest().ready(); };
  const refused = "The process host isn't running, so typeperf didn't run";
  const paths: { name: string; options: HostedOptions; before: (s: Setup) => void; after: (s: Setup) => void; hostOnly: string }[] = [
    { name: 'before the host is started', options: {}, before: () => {}, after: () => {}, hostOnly: refused },
    { name: 'urgent, while the host restarts', options: { urgent: true }, before: (s) => { up(s); s.latest().exit(1); }, after: () => {}, hostOnly: refused },
    { name: `after waiting ${HOST_WAIT_MS / 1000} s for the host`, options: {}, before: (s) => s.host.start(), after: (s) => s.fire(HOST_WAIT_MS), hostOnly: refused },
    { name: 'when the start fails', options: {}, before: (s) => s.host.start(), after: (s) => s.latest().exit(1), hostOnly: refused },
    { name: 'when they cannot be sent', options: {}, before: (s) => { up(s); s.latest().failPost = true; }, after: () => {}, hostOnly: refused },
    { name: 'when the host dies under them', options: { idempotent: true, urgent: true }, before: up, after: (s) => s.latest().exit(1), hostOnly: HOST_STOPPED_MESSAGE },
    { name: 'when the host stops answering under them', options: { idempotent: true, timeout: 10_000 }, before: up, after: (s) => s.fire(10_000 + DEADLINE_MARGIN_MS), hostOnly: 'typeperf got no answer' },
    { name: 'at quit', options: { idempotent: true }, before: up, after: (s) => s.host.stop(), hostOnly: HOST_STOPPED_MESSAGE },
  ];

  for (const path of paths) {
    it(path.name, async () => {
      // A launch Node refuses before there is a promise (spawn EINVAL), and
      // a rejection that isn't an Error.
      const runHere = vi.fn((file: string, args: string[]) => {
        if (file === 'throws') throw new Error('spawn EINVAL');
        if (file === 'rejects') return Promise.reject('not an Error');
        return Promise.resolve({ stdout: `here: ${file} ${args.join(' ')}` });
      });
      const s = setup({ runHere });
      path.before(s);
      const [thrown, notAnError, fine, hostOnly] = (function askedFromHere() {
        return [
          s.host.run('throws', [], path.options),
          s.host.run('rejects', [], path.options),
          s.host.run('fine', [], path.options),
          s.host.runInHost('typeperf', [], path.options),
        ];
      })();
      path.after(s);

      // The throw fails its command only: the next ones still run.
      await expect(thrown).rejects.toThrow('spawn EINVAL');
      expect(runHere.mock.calls.map(([file]) => file)).toEqual(['throws', 'rejects', 'fine']);
      await expect(fine).resolves.toEqual({ stdout: 'here: fine ' });
      const wrapped = await notAnError.then(() => null, (e: unknown) => e);
      expect(wrapped).toBeInstanceOf(Error);
      expect((wrapped as Error).message).toBe('not an Error');
      expect((wrapped as Error).stack).toContain('askedFromHere');
      const refusal = await hostOnly.then(() => null, (e: unknown) => e);
      expect(refusal).toBeInstanceOf(Error);
      expect((refusal as Error).message).toContain(path.hostOnly);
      expect((refusal as Error).stack).toContain('askedFromHere');
    });
  }
});

describe('process host: spawned processes', () => {
  const spawnOf = (h: FakeHost) => h.sent.filter((m) => (m as { type?: string }).type !== undefined) as unknown as (SpawnRequest | StdioRequest)[];

  it('starts a process in the host and passes on its output and exit', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();

    const proc = host.spawn('C:\\sdk\\claude.exe', ['--x'], { cwd: '/w', env: { A: '1' } });
    const seen = watch(proc);
    expect(spawnOf(latest())).toEqual([{ type: 'spawn', id: 1, file: 'C:\\sdk\\claude.exe', args: ['--x'], cwd: '/w', env: { A: '1' } }]);
    expect(proc.pid).toBeUndefined();
    expect(proc.exitCode).toBeNull();

    latest().emit('message', { type: 'spawned', id: 1, pid: 42, launchMs: 5 });
    latest().emit('message', { type: 'stdout', id: 1, data: '{"type":"system"}\n' });
    latest().emit('message', { type: 'exit', id: 1, code: 0, signal: null });
    latest().emit('message', { type: 'stdout-end', id: 1 });
    latest().emit('message', { type: 'stderr-end', id: 1 });
    latest().emit('message', { type: 'close', id: 1 });
    await settle();

    expect(proc.pid).toBe(42);
    expect(proc.exitCode).toBe(0);
    expect(seen).toEqual(['exit 0 null', 'close', 'out {"type":"system"}\n', 'out end']);
  });

  it('hands its output on through timeOutput, with its size, and nothing else', async () => {
    const timed: number[] = [];
    const timeOutput = vi.fn((chars: number, deliver: () => void) => { timed.push(chars); deliver(); });
    const { host, latest } = setup({ timeOutput });
    host.start();
    latest().ready();
    const proc = host.spawn('claude.exe', []);
    const seen = watch(proc);
    latest().emit('message', { type: 'spawned', id: 1, pid: 42, launchMs: 5 });
    latest().emit('message', { type: 'stdout', id: 1, data: '{"a":1}\n' });
    latest().emit('message', { type: 'stderr', id: 1, data: 'warn' });
    latest().emit('message', { type: 'exit', id: 1, code: 0, signal: null });
    await settle();
    expect(timed).toEqual([8, 4]);
    expect(seen).toEqual(['exit 0 null', 'out {"a":1}\n']);

    // A process started here, the host never having come up, the same way.
    const down = setup({ timeOutput });
    down.host.start();
    watch(down.host.spawn('claude.exe', []));
    down.fire(HOST_START_TIMEOUT_MS);
    down.local[0].post({ type: 'stdout', id: 0, data: 'xyz' });
    expect(timed).toEqual([8, 4, 3]);
  });

  it('passes output on as strings, as the host decoded it', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const proc = host.spawn('claude.exe', []);
    const chunks: unknown[] = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    latest().emit('message', { type: 'stdout', id: 1, data: '€ {"a":1}\n' });
    await settle();
    expect(chunks).toEqual(['€ {"a":1}\n']);
  });

  it('sends its input, and a request to stop it, to the host', async () => {
    const { host, latest } = setup();
    host.start();
    latest().ready();
    const proc = host.spawn('claude.exe', []);

    proc.stdin.write('{"type":"user"}\n');
    proc.stdin.end();
    await settle();
    expect(proc.kill('SIGTERM')).toBe(true);
    expect(proc.killed).toBe(true);

    expect(spawnOf(latest()).slice(1)).toEqual([
      { type: 'stdin', id: 1, data: '{"type":"user"}\n' },
      { type: 'stdin-end', id: 1 },
      { type: 'kill', id: 1, signal: 'SIGTERM' },
    ]);
  });

  it('waits for a starting host rather than starting the process here', async () => {
    const { host, local, latest } = setup();
    host.start();
    const proc = host.spawn('claude.exe', ['--x']);
    proc.stdin.write('early\n');
    await settle();
    expect(local).toEqual([]);
    expect(latest().sent).toEqual([]);

    latest().ready();
    expect(spawnOf(latest())).toEqual([
      { type: 'spawn', id: 1, file: 'claude.exe', args: ['--x'] },
      { type: 'stdin', id: 1, data: 'early\n' },
    ]);
  });

  it('waits through a restart after a failure', () => {
    const { host, hosts, local, fire, latest } = setup();
    host.start();
    latest().ready();
    latest().exit(1);

    host.spawn('claude.exe', []);
    expect(local).toEqual([]);
    fire(RESTART_DELAY_MS);
    latest().ready();
    expect(hosts).toHaveLength(2);
    expect(spawnOf(latest())).toEqual([{ type: 'spawn', id: 1, file: 'claude.exe', args: [] }]);
  });

  it('starts the process here when the host never came up', async () => {
    const { host, local, fire, latest } = setup();
    host.start();
    const proc = host.spawn('claude.exe', ['--x'], { cwd: '/w' });
    proc.stdin.write('hi\n');
    fire(HOST_START_TIMEOUT_MS);
    await settle();

    expect(latest().sent).toEqual([]);
    expect(local).toHaveLength(1);
    expect(local[0].requests).toEqual([
      { type: 'spawn', id: 0, file: 'claude.exe', args: ['--x'], cwd: '/w' },
      { type: 'stdin', id: 0, data: 'hi\n' },
    ]);
    local[0].post({ type: 'spawned', id: 0, pid: 7, launchMs: 1 });
    expect(proc.pid).toBe(7);
  });

  it('starts the process here when the host was never started, has given up, or has stopped', () => {
    const neverStarted = setup();
    neverStarted.host.spawn('claude.exe', []);
    expect(neverStarted.local).toHaveLength(1);

    const stopped = setup();
    stopped.host.start();
    stopped.latest().ready();
    stopped.latest().exit(1);
    stopped.host.stop();
    stopped.host.spawn('claude.exe', []);
    expect(stopped.local).toHaveLength(1);
  });

  it('reports a start that Node throws here to listeners added once spawn has returned', async () => {
    // The host down, the process starts in this process, inside spawn(); on
    // Windows Node throws EINVAL, EPERM or ENAMETOOLONG rather than emit them.
    const einval = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL', syscall: 'spawn' });
    const throwing = (() => { throw einval; }) as unknown as Parameters<typeof createSpawnRunner>[1];
    const { host } = setup({ spawnHere: (post) => createSpawnRunner(post, throwing) });

    const proc = host.spawn('npm', ['install'], { findCommand: true });
    const errors: Error[] = [];
    proc.on('error', (e: Error) => errors.push(e));
    const seen = watch(proc);
    await settle();

    expect(errors).toEqual([expect.objectContaining({ code: 'EINVAL', message: 'spawn EINVAL' })]);
    expect(seen).toEqual(['close', 'out end']);
  });

  it('a process stopped before the host came up never starts', () => {
    const { host, local, latest } = setup();
    host.start();
    const proc = host.spawn('claude.exe', []);
    const seen = watch(proc);
    proc.kill('SIGTERM');

    latest().ready();
    expect(latest().sent).toEqual([]);
    expect(local).toEqual([]);
    expect(seen).toEqual(['exit null SIGKILL', 'close']);
  });

  it('stops and ends its processes when the host dies', async () => {
    const { host, notes, killed, latest } = setup();
    host.start();
    latest().ready();
    const proc = host.spawn('C:\\sdk\\claude.exe', []);
    const seen = watch(proc);
    latest().emit('message', { type: 'spawned', id: 1, pid: 42, launchMs: 5 });

    latest().exit(1);
    await settle();

    expect(killed).toEqual([42]);
    expect(seen).toEqual(['exit null SIGKILL', 'close', 'out end']);
    expect(notes).toContain('claude.exe stopped with the process host');
    // Input for it goes nowhere now.
    proc.stdin.write('late\n');
  });

  it('says a process was lost to a host that died, not to one stopped at quit', () => {
    const crashed = setup();
    crashed.host.start();
    crashed.latest().ready();
    const proc = crashed.host.spawn('claude', ['mcp', 'list'], { shell: true });
    expect(spawnOf(crashed.latest())).toEqual([{ type: 'spawn', id: 1, file: 'claude', args: ['mcp', 'list'], shell: true }]);
    crashed.latest().exit(1);
    expect(proc.hostDied).toBe(true);

    const quit = setup();
    quit.host.start();
    quit.latest().ready();
    const atQuit = quit.host.spawn('claude', ['mcp', 'list'], { shell: true });
    quit.host.stop();
    expect(atQuit.exitCode).toBeNull();
    expect(atQuit.signalCode).toBe('SIGKILL');
    expect(atQuit.hostDied).toBe(false);
  });

  it('notes a slow start the host absorbed', () => {
    const { host, notes, latest } = setup();
    host.start();
    latest().ready();
    host.spawn('C:\\sdk\\claude.exe', []);
    latest().emit('message', { type: 'spawned', id: 1, pid: 42, launchMs: 21_446 });
    expect(notes).toEqual(['claude.exe took 21446 ms to start, in the process host (the window kept responding)']);
  });

  it('starts the process here when the request cannot be sent', () => {
    const { host, local, latest } = setup();
    host.start();
    latest().ready();
    latest().failPost = true;
    host.spawn('claude.exe', []);
    expect(local).toHaveLength(1);
  });

  it('names the host, and what it runs, in its notes', () => {
    const { host, notes, fire, latest } = setup({ name: 'agent host', runs: 'agents' });
    host.start();
    for (let i = 0; i < MAX_FAILURES; i++) {
      latest().ready();
      latest().exit(1);
      fire(RESTART_DELAY_MS);
    }
    expect(notes.at(-1)).toBe('agent host exited with code 1; agents run in the main process from now on');
  });
});

describe('isReadOnly', () => {
  it('knows the git commands that only read', () => {
    for (const args of [
      ['--version'], ['rev-parse', '--abbrev-ref', 'HEAD'], ['status', '--porcelain=v1', '-z'], ['diff', '--numstat'],
      ['show', 'HEAD:a.ts'], ['log', '-10'], ['merge-base', 'a', 'b'], ['ls-files', '--error-unmatch', '--', 'x'],
      ['check-ignore', '-q', '--', 'x'], ['check-ref-format', '--branch', 'feat'], ['show-ref', '--verify', '--quiet', 'refs/heads/x'],
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], ['reflog', 'show', 'HEAD'],
      ['branch', '-r', '--format=%(refname:short)'], ['remote'], ['config', 'user.name'], ['worktree', 'list', '--porcelain'],
    ]) expect(isReadOnly('git', args), args.join(' ')).toBe(true);
  });

  it('leaves out every git command that writes, or might', () => {
    for (const args of [
      ['commit', '-m', 'x'], ['add', '-A'], ['fetch', '--prune'], ['push'], ['checkout', '-b', 'x'], ['worktree', 'add', 'p', 'b'],
      ['symbolic-ref', 'HEAD', 'refs/heads/x'], ['symbolic-ref', '--delete', 'HEAD'], ['reflog', 'expire'],
      ['branch', '-D', 'x'], ['branch', 'new'], ['branch', '--set-upstream-to=origin/x'], ['remote', 'add', 'o', 'u'],
      ['config', 'user.name', 'Jo'], ['config', '--unset', 'user.name'], ['hash-object', '-w', 'x'], ['-C', 'dir', 'status'], [],
    ]) expect(isReadOnly('git', args), args.join(' ')).toBe(false);
  });

  it('knows the gh commands that only read', () => {
    expect(isReadOnly('gh', ['pr', 'view', 'b', '--json', 'number'])).toBe(true);
    expect(isReadOnly('gh', ['pr', 'list', '--head', 'b'])).toBe(true);
    expect(isReadOnly('gh', ['auth', 'status'])).toBe(true);
    expect(isReadOnly('gh', ['api', 'repos/{owner}/{repo}/pulls/1/comments?per_page=100'])).toBe(true);
    expect(isReadOnly('C:\\Program Files\\GitHub CLI\\gh.exe', ['--version'])).toBe(true);

    expect(isReadOnly('gh', ['pr', 'create', '--title', 't'])).toBe(false);
    expect(isReadOnly('gh', ['pr', 'merge', '1'])).toBe(false);
    expect(isReadOnly('gh', ['api', '-X', 'POST', 'repos/o/r/issues'])).toBe(false);
    expect(isReadOnly('gh', ['api', 'repos/o/r/issues', '-f', 'title=x'])).toBe(false);
    expect(isReadOnly('gh', ['api', '--method=PATCH', 'x'])).toBe(false);
  });

  it('leaves out other programs', () => {
    expect(isReadOnly('npm', ['ls'])).toBe(false);
  });
});
