import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  createProcessHost, HOST_START_TIMEOUT_MS, HOST_STOPPED_MESSAGE, MAX_FAILURES, RESTART_DELAY_MS, SLOW_HOSTED_LAUNCH_MS,
  type HostProcess,
} from './process-host.js';
import { HOST_READY, type HostReply, type HostRequest } from './process-host-protocol.js';

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
  reply(reply: HostReply): void { this.emit('message', reply); }
  exit(code = 1): void { this.emit('exit', code); }
}

/** A host on fake forks and hand-run timers. */
function setup() {
  const hosts: FakeHost[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const notes: string[] = [];
  const runHere = vi.fn(async (file: string, args: string[]) => ({ stdout: `here: ${file} ${args.join(' ')}` }));
  const host = createProcessHost({
    fork: () => { const h = new FakeHost(); hosts.push(h); return h; },
    runHere,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false, unref: () => {} }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) (t as { cleared: boolean }).cleared = true; },
    note: (line) => notes.push(line),
  });
  /** Run the pending timers set for `ms`. */
  const fire = (ms: number) => {
    for (const t of timers.filter((x) => x.ms === ms && !x.cleared)) { t.cleared = true; t.fn(); }
  };
  return { host, hosts, runHere, notes, fire, latest: () => hosts[hosts.length - 1] };
}

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
});
