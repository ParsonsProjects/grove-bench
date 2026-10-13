import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createProcessHost, isReadOnly, type ProcessHostDeps, DEADLINE_MARGIN_MS, HEALTHY_UPTIME_MS, HOST_START_TIMEOUT_MS, HOST_STOPPED_MESSAGE, MAX_FAILURES,
  RESTART_DELAY_MS, SLOW_HOSTED_LAUNCH_MS, type HostProcess,
} from './process-host.js';
import { HOST_READY, type HostReply, type HostRequest, type SpawnEvent, type SpawnRequest, type StdioRequest } from './process-host-protocol.js';
import type { HostedProcess } from './process-host-spawn.js';

/** A stand-in for the utility process: keeps what it was sent. */
class FakeHost extends EventEmitter implements HostProcess {
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
  it('runs commands in this process until it is started and ready', async () => {
    const { host, hosts, runHere, latest } = setup();
    await expect(host.run('git', ['status'])).resolves.toEqual({ stdout: 'here: git status' });

    host.start();
    expect(hosts).toHaveLength(1);
    await host.run('git', ['log'], { cwd: '/r' });
    expect(runHere).toHaveBeenLastCalledWith('git', ['log'], { cwd: '/r' });
    expect(latest().sent).toEqual([]);
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
    expect(notes.at(-1)).toBe('process host exited with code 1; git and gh run in the main process from now on');
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

  it('stops the processes the host started when it dies, and runs read-only ones again here', async () => {
    const { host, runHere, killed, latest } = setup();
    host.start();
    latest().ready();
    const status = host.run('git', ['status', '--porcelain'], { cwd: '/r' });
    const commit = host.run('git', ['commit', '-m', 'x'], { cwd: '/r' });
    latest().started(1, 4242);
    latest().started(2, 4343);
    latest().exit(1);

    expect(killed).toEqual([4242, 4343]);
    await expect(status).resolves.toEqual({ stdout: 'here: git status --porcelain' });
    expect(runHere).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/r' });
    await expect(commit).rejects.toThrow(HOST_STOPPED_MESSAGE);
    expect(runHere).toHaveBeenCalledTimes(1);
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
