import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
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

import { createSpawnRunner, HostedProcess, type ProcessCommand } from './process-host-spawn.js';
import type { SpawnEvent } from './process-host-protocol.js';

/** Let stream events (they come on the next tick) run. */
const settle = () => new Promise((r) => setImmediate(r));

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(realPlatform);
  found.clear();
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
});

describe('createSpawnRunner', () => {
  /** Run a request through a runner with real processes; resolve on close. */
  function run(script: string, onSpawned?: (runner: ReturnType<typeof createSpawnRunner>) => void) {
    const events: SpawnEvent[] = [];
    return new Promise<SpawnEvent[]>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'spawned') onSpawned?.(runner);
        if (event.type === 'close') resolve(events);
      });
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
      });
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
    }) as unknown as Parameters<typeof createSpawnRunner>[1];
    const runner = createSpawnRunner(() => {}, fakeSpawn);
    runner.handle({ type: 'spawn', id: 1, file: 'gemini', args: ['--acp'], cwd: '/w', findCommand: true });
    runner.handle({ type: 'spawn', id: 2, file: '/abs/claude', args: ['--x'], cwd: '/w' });
    expect(parseCalls).toEqual([{ command: 'gemini', args: ['--acp'] }]);
    expect(calls[0]).toMatchObject({ file: 'cmd.exe', args: ['/d', '/s', '/c', '"gemini --acp"'], options: { windowsVerbatimArguments: true, cwd: '/w' } });
    expect(calls[1]).toMatchObject({ file: '/abs/claude', args: ['--x'], options: { cwd: '/w', stdio: 'pipe', windowsHide: true } });
  });

  it('reports a start Node throws (EINVAL) on the next tick, as Node reports the others', async () => {
    const events: SpawnEvent[] = [];
    const einval = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL', errno: -4071, syscall: 'spawn' });
    const throwing = (() => { throw einval; }) as unknown as Parameters<typeof createSpawnRunner>[1];
    const runner = createSpawnRunner((event) => events.push(event), throwing);
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

  it("throws a process's output away where it runs when asked, and keeps its stderr", async () => {
    const events: SpawnEvent[] = [];
    await new Promise<void>((resolve) => {
      const runner = createSpawnRunner((event) => {
        events.push(event);
        if (event.type === 'close') resolve();
      });
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
    }) as unknown as Parameters<typeof createSpawnRunner>[1];
    const runner = createSpawnRunner(() => {}, fakeSpawn);
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
      const runner = createSpawnRunner((event) => events.push(event), (() => child) as unknown as Parameters<typeof createSpawnRunner>[1]);
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
    const runner = createSpawnRunner(() => {});
    expect(() => runner.handle({ type: 'stdin', id: 404, data: 'x' })).not.toThrow();
    expect(() => runner.handle({ type: 'kill', id: 404, signal: 'SIGTERM' })).not.toThrow();
  });
});
