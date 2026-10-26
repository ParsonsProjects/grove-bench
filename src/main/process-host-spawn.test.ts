import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

// cross-spawn's parse, as it would wrap an npm shim on Windows, recorded.
// `file` is the program it found: only those in `found`.
const parseCalls: Array<{ command: string; args: readonly string[] }> = [];
const found = new Map<string, string>();
vi.mock('cross-spawn', () => ({
  default: {
    _parse: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      parseCalls.push({ command, args });
      return {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', `"${[command, ...args].join(' ')}"`],
        options: { ...options, windowsVerbatimArguments: true },
        file: found.get(command),
      };
    },
  },
}));

import { createSpawnRunner, HostedProcess, TREE_KILL_ANSWER_MS, type KillTree, type ProcessCommand } from './process-host-spawn.js';
import type { SpawnEvent } from './process-host-protocol.js';
import { killTreeWith } from './process-tree-kill.js';
import { execa } from 'execa';

/** A runner's tree kill that does nothing, for tests that don't ask for one. */
const noKill: KillTree = () => Promise.resolve(undefined);

/** Let stream events (they come on the next tick) run. */
const settle = () => new Promise((r) => setImmediate(r));

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Real processes a test started, to stop if a failed test left them running. */
const startedPids: number[] = [];

afterEach(() => {
  vi.useRealTimers();
  setPlatform(realPlatform);
  found.clear();
  parseCalls.length = 0;
  for (const pid of startedPids.splice(0)) if (isRunning(pid)) process.kill(pid);
});

describe('HostedProcess', () => {
  it('holds input and stop requests until it is connected, then sends them in order', async () => {
    const proc = new HostedProcess('claude.exe');
    proc.stdin.write('one\n');
    proc.kill('SIGTERM');
    await settle();

    const sent: ProcessCommand[] = [];
    proc.connect((c) => sent.push(c));
    proc.stdin.write('two\n');
    await settle();

    expect(sent).toEqual([
      { type: 'stdin', data: 'one\n' },
      { type: 'kill', signal: 'SIGTERM' },
      { type: 'stdin', data: 'two\n' },
    ]);
  });

  it('looks like a running ChildProcess until it exits', () => {
    const proc = new HostedProcess('claude.exe');
    proc.connect(() => {});
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBeNull();
    expect(proc.killed).toBe(false);

    proc.receive({ type: 'exit', id: 1, code: 3, signal: null });
    expect(proc.exitCode).toBe(3);
    // Nothing left to stop.
    expect(proc.kill('SIGTERM')).toBe(false);
    expect(proc.killed).toBe(false);
  });

  it('ignores output after its stream ended, and a second exit or close', async () => {
    const proc = new HostedProcess('claude.exe');
    const seen: string[] = [];
    proc.stdout.on('data', (d: Buffer) => seen.push(d.toString()));
    proc.on('exit', () => seen.push('exit'));
    proc.on('close', () => seen.push('close'));

    proc.receive({ type: 'stdout', id: 1, data: 'a' });
    proc.receive({ type: 'stdout-end', id: 1 });
    proc.receive({ type: 'stdout', id: 1, data: 'late' });
    proc.receive({ type: 'exit', id: 1, code: 0, signal: null });
    proc.receive({ type: 'exit', id: 1, code: 1, signal: null });
    proc.receive({ type: 'close', id: 1 });
    proc.lost();
    await settle();

    expect(seen).toEqual(['exit', 'close', 'a']);
    expect(proc.exitCode).toBe(0);
  });

  it('passes a failed start on as an error, with the fields the SDK reads', () => {
    const proc = new HostedProcess('claude.exe');
    const errors: Error[] = [];
    proc.on('error', (e: Error) => errors.push(e));
    proc.receive({ type: 'error', id: 1, error: { name: 'Error', message: 'spawn claude.exe ENOENT', code: 'ENOENT', syscall: 'spawn claude.exe', path: 'claude.exe' } });
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]).toMatchObject({ code: 'ENOENT', syscall: 'spawn claude.exe' });
  });

  it("doesn't throw for an error nobody listens for", () => {
    const proc = new HostedProcess('claude.exe');
    expect(() => proc.receive({ type: 'error', id: 1, error: { name: 'Error', message: 'boom' } })).not.toThrow();
  });

  it('fails its input stream when writing to the process failed', async () => {
    const proc = new HostedProcess('claude.exe');
    const errors: unknown[] = [];
    proc.stdin.on('error', (e) => errors.push(e));
    proc.receive({ type: 'stdin-error', id: 1, error: { name: 'Error', message: 'write EPIPE', code: 'EPIPE' } });
    await settle();
    expect(errors).toHaveLength(1);
    expect(proc.stdin.destroyed).toBe(true);
  });

  it('when lost, exits as stopped and ends its output', async () => {
    const proc = new HostedProcess('claude.exe');
    const seen: string[] = [];
    proc.stdout.on('end', () => seen.push('end'));
    proc.stdout.resume();
    proc.on('exit', (code, signal) => seen.push(`exit ${code} ${signal}`));
    proc.lost();
    await settle();
    expect(seen).toEqual(['exit null SIGKILL', 'end']);
    expect(proc.signalCode).toBe('SIGKILL');
  });

  describe('killTree()', () => {
    it('asks where it runs once connected, and resolves true once that has killed the tree', async () => {
      const proc = new HostedProcess('claude.exe');
      const killed = proc.killTree();
      // So a launch still waiting for its host doesn't start it.
      expect(proc.stopRequested).toBe(true);
      // Unlike kill(): the agent SDK stops a process itself unless it was
      // killed, which this one may not have been yet.
      expect(proc.killed).toBe(false);
      const sent: ProcessCommand[] = [];
      proc.connect((c) => sent.push(c));
      expect(sent).toEqual([{ type: 'kill-tree' }]);

      proc.receive({ type: 'tree-killed', id: 1, killed: true });
      await expect(killed).resolves.toBe(true);
    });

    it('resolves false when there was nothing to kill', async () => {
      const proc = new HostedProcess('claude.exe');
      proc.connect(() => {});
      const killed = proc.killTree();
      proc.receive({ type: 'tree-killed', id: 1, killed: false });
      await expect(killed).resolves.toBe(false);
    });

    it('rejects with what went wrong when the kill failed', async () => {
      const proc = new HostedProcess('claude.exe');
      proc.connect(() => {});
      const killed = proc.killTree();
      proc.receive({ type: 'tree-killed', id: 1, killed: false, failure: 'taskkill 4242 failed: ERROR: Access is denied.' });
      await expect(killed).rejects.toThrow('taskkill 4242 failed: ERROR: Access is denied.');
    });

    it('asked again, gives the same answer, asking once', async () => {
      const proc = new HostedProcess('claude.exe');
      const sent: ProcessCommand[] = [];
      proc.connect((c) => sent.push(c));
      const first = proc.killTree();
      const second = proc.killTree();
      expect(second).toBe(first);
      expect(sent).toEqual([{ type: 'kill-tree' }]);
      proc.receive({ type: 'tree-killed', id: 1, killed: true });
      await expect(second).resolves.toBe(true);
    });

    it('resolves false at once for a process that has exited or closed, asking nothing', async () => {
      const exited = new HostedProcess('claude.exe');
      const sent: ProcessCommand[] = [];
      exited.connect((c) => sent.push(c));
      exited.receive({ type: 'exit', id: 1, code: 0, signal: null });
      const closed = new HostedProcess('claude.exe');
      closed.lost();

      await expect(exited.killTree()).resolves.toBe(false);
      await expect(closed.killTree()).resolves.toBe(false);
      expect(sent).toEqual([]);
      expect(exited.stopRequested).toBe(false);
    });

    it('resolves false when it closes without an answer: it never started, or exited before the request reached it', async () => {
      const neverStarted = new HostedProcess('claude.exe');
      const killed = neverStarted.killTree();
      // What process-host.ts does with a process killed before its launch.
      neverStarted.lost();
      await expect(killed).resolves.toBe(false);
    });

    it('rejects when its host goes before answering, once the process had started', async () => {
      const proc = new HostedProcess('claude.exe');
      proc.connect(() => {});
      proc.receive({ type: 'spawned', id: 1, pid: 4242, launchMs: 5 });
      const killed = proc.killTree();
      proc.lost(true);
      await expect(killed).rejects.toThrow("The process host stopped before claude.exe's process tree was killed");
    });

    it(`rejects when no answer comes within ${TREE_KILL_ANSWER_MS / 1000} s`, async () => {
      vi.useFakeTimers();
      const proc = new HostedProcess('claude.exe');
      proc.connect(() => {});
      let outcome = 'waiting';
      proc.killTree().then(() => { outcome = 'resolved'; }, (e: Error) => { outcome = e.message; });
      await vi.advanceTimersByTimeAsync(TREE_KILL_ANSWER_MS - 1);
      expect(outcome).toBe('waiting');
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBe(`No answer within ${TREE_KILL_ANSWER_MS / 1000} s to killing claude.exe's process tree`);
    });
  });
});

describe('createSpawnRunner', () => {
  /** Run a request through a runner with real processes; resolve on close. */
  function run(script: string, onSpawned?: (runner: ReturnType<typeof createSpawnRunner>) => void, killTree: KillTree = noKill) {
    const events: SpawnEvent[] = [];
    return new Promise<SpawnEvent[]>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'spawned') onSpawned?.(runner);
        if (event.type === 'close') resolve(events);
      }, killTree);
      runner.handle({ type: 'spawn', id: 5, file: process.execPath, args: ['-e', script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    });
  }
  const text = (events: SpawnEvent[], stream: 'stdout' | 'stderr') =>
    events.filter((e): e is Extract<SpawnEvent, { type: 'stdout' | 'stderr' }> => e.type === stream).map((e) => e.data).join('');

  it('starts a process, feeds it input and reports its output and exit', async () => {
    const events = await run(
      "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase())); process.stderr.write('note');",
      (runner) => {
        runner.handle({ type: 'stdin', id: 5, data: 'hello\n' });
        runner.handle({ type: 'stdin-end', id: 5 });
      },
    );
    expect(events[0]).toMatchObject({ type: 'spawned', id: 5, pid: expect.any(Number), launchMs: expect.any(Number) });
    expect(text(events, 'stdout')).toBe('HELLO\n');
    expect(text(events, 'stderr')).toBe('note');
    expect(events).toContainEqual({ type: 'exit', id: 5, code: 0, signal: null });
    expect(events.at(-1)).toEqual({ type: 'close', id: 5 });
  });

  it('keeps a character whole when the process writes it in two parts', async () => {
    const events = await run('process.stdout.write(Buffer.from([0xe2, 0x82])); setTimeout(() => process.stdout.write(Buffer.from([0xac])), 50);');
    expect(text(events, 'stdout')).toBe('€');
  });

  it('stops a process on request', async () => {
    const events = await run('setInterval(() => {}, 1000);', (runner) => runner.handle({ type: 'kill', id: 5, signal: 'SIGTERM' }));
    expect(events.find((e) => e.type === 'exit')).toMatchObject({ type: 'exit', id: 5 });
  });

  it('reports a file that is not there as a failed start, then closes', async () => {
    const events: SpawnEvent[] = [];
    await new Promise<void>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'close') resolve();
      }, noKill);
      runner.handle({ type: 'spawn', id: 9, file: '/no/such/claude', args: [] });
    });
    expect(events.find((e) => e.type === 'spawned')).toBeUndefined();
    expect(events.find((e) => e.type === 'error')).toMatchObject({ error: { code: 'ENOENT', syscall: 'spawn /no/such/claude' } });
  });

  it('finds a command as a shell would when asked, with the parse execa runs, and only then', () => {
    const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const fakeSpawn = ((file: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      throw new Error('not starting it');
    }) as unknown as Parameters<typeof createSpawnRunner>[2];
    const runner = createSpawnRunner(() => {}, noKill, fakeSpawn);
    runner.handle({ type: 'spawn', id: 1, file: 'gemini', args: ['--acp'], cwd: '/w', findCommand: true });
    runner.handle({ type: 'spawn', id: 2, file: '/abs/claude', args: ['--x'], cwd: '/w' });
    expect(parseCalls).toEqual([{ command: 'gemini', args: ['--acp'] }]);
    expect(calls[0]).toMatchObject({ file: 'cmd.exe', args: ['/d', '/s', '/c', '"gemini --acp"'], options: { windowsVerbatimArguments: true, cwd: '/w' } });
    expect(calls[1]).toMatchObject({ file: '/abs/claude', args: ['--x'], options: { cwd: '/w', stdio: 'pipe', windowsHide: true } });
  });

  it('reports a start Node throws (EINVAL) on the next tick, as Node reports the others', async () => {
    const events: SpawnEvent[] = [];
    const einval = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL', errno: -4071, syscall: 'spawn' });
    const throwing = (() => { throw einval; }) as unknown as Parameters<typeof createSpawnRunner>[2];
    const runner = createSpawnRunner((event) => events.push(event), noKill, throwing);
    runner.handle({ type: 'spawn', id: 3, file: 'C:\\tools\\agent.bat', args: [] });
    // Nothing yet: run in the main process, it would reach the
    // HostedProcess before spawnProcess had returned it.
    expect(events).toEqual([]);
    await settle();
    expect(events).toEqual([
      { type: 'error', id: 3, error: expect.objectContaining({ code: 'EINVAL', syscall: 'spawn', message: 'spawn EINVAL' }) },
      { type: 'close', id: 3 },
    ]);
  });

  it('runs a command line in a shell as execa does: joined with spaces, as given', () => {
    const calls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const fakeSpawn = ((file: string, args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      throw new Error('not starting it');
    }) as unknown as Parameters<typeof createSpawnRunner>[2];
    const runner = createSpawnRunner(() => {}, noKill, fakeSpawn);
    runner.handle({ type: 'spawn', id: 1, file: 'claude', args: ['mcp', 'remove', '"my server"'], cwd: '/w', shell: true, findCommand: true });
    expect(parseCalls).toEqual([]);
    expect(calls).toEqual([{ file: 'claude mcp remove "my server"', args: [], options: { cwd: '/w', env: undefined, stdio: 'pipe', windowsHide: true, shell: true } }]);
  });

  it('runs a real command line in a shell', async () => {
    const events: SpawnEvent[] = [];
    await new Promise<void>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'close') resolve();
      }, noKill);
      runner.handle({ type: 'spawn', id: 3, file: 'echo', args: ['one', 'two'], shell: true });
    });
    expect(events.filter((e) => e.type === 'stdout').map((e) => (e as { data: string }).data).join('').trim()).toBe('one two');
    expect(events).toContainEqual({ type: 'exit', id: 3, code: 0, signal: null });
  });

  it("throws a process's output away where it runs when asked, and keeps its stderr", async () => {
    const events: SpawnEvent[] = [];
    await new Promise<void>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'close') resolve();
      }, noKill);
      runner.handle({
        type: 'spawn', id: 6, file: process.execPath, stdout: 'ignore',
        args: ['-e', "process.stdout.write('added 1 package'); process.stderr.write('npm warn')"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    });
    expect(events.filter((e) => e.type === 'stdout')).toEqual([]);
    expect(events).toContainEqual({ type: 'stdout-end', id: 6 });
    expect(text(events, 'stderr')).toBe('npm warn');
    expect(events).toContainEqual({ type: 'exit', id: 6, code: 0, signal: null });
  });

  it('pipes stdout unless told to ignore it', () => {
    const calls: Array<{ options: Record<string, unknown> }> = [];
    const fakeSpawn = ((_file: string, _args: readonly string[], options: Record<string, unknown>) => {
      calls.push({ options });
      throw new Error('not starting it');
    }) as unknown as Parameters<typeof createSpawnRunner>[2];
    const runner = createSpawnRunner(() => {}, noKill, fakeSpawn);
    runner.handle({ type: 'spawn', id: 1, file: 'npm', args: [], stdout: 'ignore', findCommand: true });
    runner.handle({ type: 'spawn', id: 2, file: 'claude', args: [] });
    expect(calls[0].options).toMatchObject({ stdio: ['pipe', 'ignore', 'pipe'], windowsVerbatimArguments: true });
    expect(calls[1].options).toMatchObject({ stdio: 'pipe' });
  });

  describe('a command it was asked to find, that ends with exit code 1', () => {
    /** Start `file` (found as a shell would, unless `findCommand` is false)
     *  on a stand-in process that exits 1, as cmd.exe does for a command
     *  that isn't there. */
    function exitsOne(file: string, findCommand = true) {
      const events: SpawnEvent[] = [];
      const child = Object.assign(new EventEmitter(), { pid: 77, stdin: new PassThrough(), stdout: null, stderr: null, kill: () => true });
      const runner = createSpawnRunner((event) => events.push(event), noKill, (() => child) as unknown as Parameters<typeof createSpawnRunner>[2]);
      runner.handle({ type: 'spawn', id: 4, file, args: ['install'], findCommand });
      child.emit('exit', 1, null);
      child.emit('close', 1, null);
      return events.filter((e) => e.type !== 'stdout-end' && e.type !== 'stderr-end');
    }

    it("on Windows, when it wasn't found (cmd.exe: \"is not recognized\"), is ENOENT, as Node reports a missing program", () => {
      setPlatform('win32');
      expect(exitsOne('npm')).toEqual([
        { type: 'spawned', id: 4, pid: 77, launchMs: expect.any(Number) },
        { type: 'error', id: 4, error: expect.objectContaining({ code: 'ENOENT', syscall: 'spawn npm', path: 'npm', message: 'spawn npm ENOENT' }) },
        { type: 'close', id: 4 },
      ]);
    });

    it('on Windows, when it was found, is a failure like any other', () => {
      setPlatform('win32');
      found.set('npm', 'C:\\Program Files\\nodejs\\npm.cmd');
      expect(exitsOne('npm')).toContainEqual({ type: 'exit', id: 4, code: 1, signal: null });
    });

    it('elsewhere, or when not asked to find it, is a failure like any other', () => {
      setPlatform('linux');
      expect(exitsOne('npm')).toContainEqual({ type: 'exit', id: 4, code: 1, signal: null });
      setPlatform('win32');
      expect(exitsOne('C:\\tools\\agent.exe', false)).toContainEqual({ type: 'exit', id: 4, code: 1, signal: null });
    });
  });

  it('ignores input for a process it does not have', () => {
    const runner = createSpawnRunner(() => {}, noKill);
    expect(() => runner.handle({ type: 'stdin', id: 404, data: 'x' })).not.toThrow();
    expect(() => runner.handle({ type: 'kill', id: 404, signal: 'SIGTERM' })).not.toThrow();
    expect(() => runner.handle({ type: 'kill-tree', id: 404 })).not.toThrow();
  });

  describe('kill-tree', () => {
    /** A stand-in process the runner starts, and the events it posts. */
    function standIn(killTree: KillTree) {
      const events: SpawnEvent[] = [];
      const child = Object.assign(new EventEmitter(), {
        pid: 77, exitCode: null as number | null, signalCode: null as string | null,
        stdin: new PassThrough(), stdout: null, stderr: null, kill: () => true,
      });
      const runner = createSpawnRunner((event) => events.push(event), killTree, (() => child) as unknown as Parameters<typeof createSpawnRunner>[2]);
      runner.handle({ type: 'spawn', id: 4, file: 'claude', args: [] });
      const exit = (code: number) => {
        child.exitCode = code;
        child.emit('exit', code, null);
        child.emit('close', code, null);
      };
      const posted = () => events.filter((e) => e.type !== 'spawned' && e.type !== 'stdout-end' && e.type !== 'stderr-end');
      return { runner, child, exit, posted };
    }

    it('kills the tree of a running process by its pid, and closes it only after saying so', async () => {
      let finish = (_failure?: string) => {};
      const killTree = vi.fn<KillTree>(() => new Promise((resolve) => { finish = resolve; }));
      const { runner, exit, posted } = standIn(killTree);

      runner.handle({ type: 'kill-tree', id: 4 });
      expect(killTree).toHaveBeenCalledWith(77);
      // taskkill ends the process before it has finished with the tree.
      exit(1);
      expect(posted()).toEqual([{ type: 'exit', id: 4, code: 1, signal: null }]);

      finish();
      await settle();
      expect(posted()).toEqual([
        { type: 'exit', id: 4, code: 1, signal: null },
        { type: 'tree-killed', id: 4, killed: true },
        { type: 'close', id: 4 },
      ]);
    });

    it('closes as usual when the process outlives the kill', async () => {
      const { runner, exit, posted } = standIn(() => Promise.resolve(undefined));
      runner.handle({ type: 'kill-tree', id: 4 });
      await settle();
      exit(0);
      expect(posted()).toEqual([
        { type: 'tree-killed', id: 4, killed: true },
        { type: 'exit', id: 4, code: 0, signal: null },
        { type: 'close', id: 4 },
      ]);
    });

    it('kills nothing for a process that has exited: its pid may be another process\'s', () => {
      const killTree = vi.fn<KillTree>(() => Promise.resolve(undefined));
      const { runner, child, posted } = standIn(killTree);
      child.exitCode = 0;
      runner.handle({ type: 'kill-tree', id: 4 });
      expect(killTree).not.toHaveBeenCalled();
      expect(posted()).toEqual([{ type: 'tree-killed', id: 4, killed: false }]);
    });

    it('says why a kill failed, whether it resolved with the reason or threw', async () => {
      const said = standIn(() => Promise.resolve('taskkill 77 failed: ERROR: Access is denied.'));
      said.runner.handle({ type: 'kill-tree', id: 4 });
      const threw = standIn(() => Promise.reject(new Error('spawn taskkill.exe ENOENT')));
      threw.runner.handle({ type: 'kill-tree', id: 4 });
      await settle();
      expect(said.posted()).toEqual([{ type: 'tree-killed', id: 4, killed: false, failure: 'taskkill 77 failed: ERROR: Access is denied.' }]);
      expect(threw.posted()).toEqual([{ type: 'tree-killed', id: 4, killed: false, failure: 'spawn taskkill.exe ENOENT' }]);
    });

    it('kills once when asked again while it is killing', async () => {
      const killTree = vi.fn<KillTree>(() => Promise.resolve(undefined));
      const { runner, posted } = standIn(killTree);
      runner.handle({ type: 'kill-tree', id: 4 });
      runner.handle({ type: 'kill-tree', id: 4 });
      await settle();
      expect(killTree).toHaveBeenCalledOnce();
      expect(posted()).toEqual([{ type: 'tree-killed', id: 4, killed: true }]);
    });

    it('kills a real process and the process it started', async () => {
      // The child prints its own child's pid, then both wait to be killed.
      const script = [
        "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "console.log(c.pid);",
        'setInterval(() => {}, 1000);',
      ].join(' ');
      let grandchild = 0;
      const events = await new Promise<SpawnEvent[]>((resolve) => {
        const seen: SpawnEvent[] = [];
        const runner = createSpawnRunner((event) => {
          seen.push(event);
          if (event.type === 'spawned') startedPids.push(event.pid);
          if (event.type === 'stdout' && !grandchild) {
            grandchild = Number(event.data.trim());
            startedPids.push(grandchild);
            runner.handle({ type: 'kill-tree', id: 8 });
          }
          if (event.type === 'close') resolve(seen);
        }, (pid) => killTreeWith(pid, (file, args, options) => execa(file, args, options)));
        runner.handle({ type: 'spawn', id: 8, file: process.execPath, args: ['-e', script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      });
      expect(grandchild).toBeGreaterThan(0);
      expect(events).toContainEqual({ type: 'tree-killed', id: 8, killed: true });
      expect(events.at(-1)).toEqual({ type: 'close', id: 8 });
      await expect.poll(() => isRunning(grandchild), { timeout: 5_000 }).toBe(false);
    }, 20_000);
  });
});

/** Whether `pid` is still running: not gone, and (on Linux) not a zombie
 *  waiting for a parent that may never reap it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') return true;
  try {
    // The state follows the command name in brackets: "123 (node) Z ...".
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}
