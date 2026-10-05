import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { IpcMain } from 'electron';
import { ChildProcess, execFile } from 'node:child_process';
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import { createFreezeLog, launchLabel, sanitizeReport, startStallWatch, freezeLog, GC_MIN_MS, STALL_GAP_MS, TICK_MS, type GcEntry } from './freeze-log.js';
import { logger } from './logger.js';

/** A freeze log on a clock the test moves by hand. */
function setup() {
  let t = 1000;
  const lines: string[] = [];
  const log = createFreezeLog({ now: () => t, write: (line) => lines.push(line) });
  return {
    log,
    lines,
    advance: (ms: number) => { t += ms; },
  };
}

/** A stand-in for ipcMain that keeps the listeners registered with it. */
function fakeIpc() {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (...args: unknown[]) => unknown) => { listeners.set(channel, listener); } };
  return { ipc: ipc as unknown as Pick<IpcMain, 'handle'>, invoke: (channel: string, ...args: unknown[]) => listeners.get(channel)!({ sender: null }, ...args) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('main-process stalls', () => {
  it('logs nothing while the timer runs on time', () => {
    const { log, lines, advance } = setup();
    for (let i = 0; i < 10; i++) { advance(TICK_MS); log.tick(); }
    advance(STALL_GAP_MS - 1); log.tick();
    expect(lines).toEqual([]);
  });

  it('also writes freezes to the app log, beside what the app was doing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    let t = 0;
    const log = createFreezeLog({ now: () => t });
    t += 300; log.tick();
    expect(warn).toHaveBeenCalledWith("[freeze] main process didn't run for 300 ms");
    warn.mockRestore();
  });

  it('logs a gap of at least the stall threshold', () => {
    const { log, lines, advance } = setup();
    advance(420); log.tick();
    expect(lines).toEqual(["main process didn't run for 420 ms"]);
  });

  it('names the IPC calls that ran during the stall, with their synchronous time', () => {
    const { log, lines, advance } = setup();
    const { ipc, invoke } = fakeIpc();
    log.timeIpcHandlers(ipc);
    ipc.handle('agent:historyPage', () => { advance(380); return 'page'; });
    ipc.handle('session:list', () => []);

    advance(TICK_MS); log.tick();
    expect(invoke('agent:historyPage')).toBe('page');
    advance(20); log.tick();

    expect(lines).toEqual(["main process didn't run for 400 ms; IPC calls during it: agent:historyPage (380 ms)"]);
  });

  it('times an async handler up to its first await, and passes its arguments through', async () => {
    const { log, lines, advance } = setup();
    const { ipc, invoke } = fakeIpc();
    log.timeIpcHandlers(ipc);
    ipc.handle('session:resume', async (_event: unknown, id: unknown) => {
      advance(200);
      await Promise.resolve();
      advance(5000); // after the await: not part of the handler's own time
      return `resumed ${String(id)}`;
    });

    const result = invoke('session:resume', 'abc');
    log.tick();
    await expect(result).resolves.toBe('resumed abc');
    expect(lines).toEqual(["main process didn't run for 200 ms; IPC calls during it: session:resume (200 ms)"]);
  });

  it('ignores the gap a system sleep leaves', () => {
    const { log, lines, advance } = setup();
    log.suspend();
    advance(60_000); log.tick();
    log.resume();
    advance(TICK_MS); log.tick();
    expect(lines).toEqual([]);
  });

  it('treats a very long gap as a sleep it missed', () => {
    const { log, lines, advance } = setup();
    advance(45_000); log.tick();
    expect(lines).toEqual([]);
  });
});

describe('window freezes', () => {
  it('logs a slow frame with its style and layout time and longest scripts', () => {
    const { log, lines } = setup();
    log.logWindowFreeze({ kind: 'frame', durationMs: 512.4, renderMs: 180.2, scripts: ['FrameRequestCallback (index.js:120) 210 ms'] });
    expect(lines).toEqual(['window took 512 ms over a frame (style and layout 180 ms); longest scripts: FrameRequestCallback (index.js:120) 210 ms']);
  });

  it('ignores a report that is not one', () => {
    const { log, lines } = setup();
    for (const bad of [null, 'slow', { kind: 'frame' }, { kind: 'nap', durationMs: 200 }, { kind: 'task', durationMs: -1 }, { kind: 'task', durationMs: Infinity }]) {
      log.logWindowFreeze(bad);
    }
    expect(lines).toEqual([]);
  });
});

describe('sanitizeReport', () => {
  it('keeps at most five scripts, one line each and capped in length', () => {
    const r = sanitizeReport({ kind: 'frame', durationMs: 150, scripts: ['a\nb', 'x'.repeat(500), 3, 'c', 'd', 'e', 'f'] });
    expect(r?.scripts).toEqual(['a b', 'x'.repeat(200), 'c', 'd', 'e']);
  });

  it('drops a render time that is not a number', () => {
    expect(sanitizeReport({ kind: 'task', durationMs: 150, renderMs: '30' })).toEqual({ kind: 'task', durationMs: 150 });
  });
});

describe('rate limit', () => {
  it('logs at most 30 freezes a minute, then says how many it skipped', () => {
    const { log, lines, advance } = setup();
    for (let i = 0; i < 35; i++) { advance(200); log.tick(); }
    expect(lines).toHaveLength(30);

    advance(60_000);
    log.resume(); // start the timer afresh after the long wait
    advance(300); log.tick();
    expect(lines.slice(30)).toEqual([
      '5 more freezes in the last minute were not logged',
      "main process didn't run for 300 ms",
    ]);
  });
});

describe('startStallWatch', () => {
  // Each test gets a stand-in, so none attaches a real gc observer to the
  // shared freeze log for the rest of the file.
  let watchGc: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { watchGc = vi.spyOn(freezeLog, 'watchGc').mockImplementation(() => {}); });
  afterEach(() => { watchGc.mockRestore(); });

  it('pauses across system sleep', () => {
    vi.useFakeTimers();
    const on = vi.fn();
    startStallWatch({ on } as never);
    expect(on.mock.calls.map(([event]) => event)).toEqual(['suspend', 'resume']);
  });

  it('measures from when the timer starts, not from when the file loaded', () => {
    const start = vi.spyOn(freezeLog, 'start');
    vi.useFakeTimers();
    startStallWatch({ on: vi.fn() } as never);
    expect(start).toHaveBeenCalledOnce();
    start.mockRestore();
  });

  it('names garbage collections', () => {
    vi.useFakeTimers();
    startStallWatch({ on: vi.fn() } as never);
    expect(watchGc).toHaveBeenCalledOnce();
  });
});

describe('timed work', () => {
  it('names work timed during a stall, beside the IPC call it ran in', () => {
    const { log, lines, advance } = setup();
    const { ipc, invoke } = fakeIpc();
    log.timeIpcHandlers(ipc);
    ipc.handle('agent:history', () => log.timeWork('event log read, 2048 KB', () => { advance(300); return []; }));

    advance(TICK_MS); log.tick();
    expect(invoke('agent:history')).toEqual([]);
    log.tick();

    expect(lines).toEqual(["main process didn't run for 300 ms; IPC calls during it: agent:history (300 ms); other work: event log read, 2048 KB (300 ms)"]);
  });

  it('returns what the work returns, and records it even when it throws', () => {
    const { log, lines, advance } = setup();
    expect(log.timeWork('quick', () => 42)).toBe(42);
    advance(TICK_MS); log.tick();
    expect(() => log.timeWork('event log rewrite, 900 events', () => { advance(200); throw new Error('EBUSY'); })).toThrow('EBUSY');
    log.tick();
    expect(lines).toEqual(["main process didn't run for 200 ms; other work: event log rewrite, 900 events (200 ms)"]);
  });
});

describe('garbage collection', () => {
  /** A freeze log watching collections that the test reports by hand. */
  function watched() {
    const s = setup();
    let report: (entry: GcEntry) => void = () => {};
    s.log.watchGc((onEntry) => { report = onEntry; });
    return { ...s, gc: (entry: GcEntry) => report(entry) };
  }

  it('writes a stall at the next tick, naming the collections Node reported meanwhile', () => {
    const { log, lines, advance, gc } = watched();
    advance(TICK_MS); log.tick();
    const from = 1000 + TICK_MS;
    advance(500); log.tick();
    expect(lines).toEqual([]);

    // Node reports a collection after the code it paused has finished.
    gc({ startTime: from + 100, duration: 380, kind: perfConstants.NODE_PERFORMANCE_GC_MAJOR });
    gc({ startTime: from + 20, duration: 12, kind: perfConstants.NODE_PERFORMANCE_GC_MINOR });
    advance(TICK_MS); log.tick();

    expect(lines).toEqual(["main process didn't run for 500 ms; garbage collection: major (380 ms), minor (12 ms)"]);
  });

  it('leaves out short collections and ones outside the stall', () => {
    const { log, lines, advance, gc } = watched();
    gc({ startTime: 900, duration: 200, kind: perfConstants.NODE_PERFORMANCE_GC_MAJOR }); // before it
    advance(400); log.tick();
    gc({ startTime: 1100, duration: GC_MIN_MS - 1, kind: perfConstants.NODE_PERFORMANCE_GC_MINOR });
    gc({ startTime: 1200, duration: 50 });
    advance(TICK_MS); log.tick();
    expect(lines).toEqual(["main process didn't run for 400 ms; garbage collection: collection (50 ms)"]);
  });

  it('keeps what ran during the stall when newer entries push it out before the line is written', () => {
    const { log, lines, advance } = watched();
    advance(TICK_MS); log.tick();
    log.timeWork('event log read, 900 KB', () => advance(400));
    log.tick();
    for (let i = 0; i < 40; i++) log.timeWork(`later ${i}`, () => {});
    advance(TICK_MS); log.tick();
    expect(lines).toEqual(["main process didn't run for 400 ms; other work: event log read, 900 KB (400 ms)"]);
  });

  it('writes a waiting stall when flushed, as at quit', () => {
    const { log, lines, advance, gc } = watched();
    advance(TICK_MS); log.tick();
    advance(300); log.tick();
    gc({ startTime: 1000 + TICK_MS + 10, duration: 250, kind: perfConstants.NODE_PERFORMANCE_GC_MAJOR });
    log.flush();
    log.flush();
    expect(lines).toEqual(["main process didn't run for 300 ms; garbage collection: major (250 ms)"]);
  });

  it('watches only once', () => {
    const { log } = setup();
    const observe = vi.fn();
    log.watchGc(observe);
    log.watchGc(observe);
    expect(observe).toHaveBeenCalledOnce();
  });

  it("listens to Node's gc entries by default", () => {
    const observe = vi.spyOn(PerformanceObserver.prototype, 'observe').mockImplementation(() => {});
    createFreezeLog({ write: () => {} }).watchGc();
    expect(observe).toHaveBeenCalledWith({ entryTypes: ['gc'] });
    observe.mockRestore();
  });
});

describe('process launches', () => {
  /** A stand-in for ChildProcess.prototype whose launches take `ms`. */
  function fakeProto(advance: (ms: number) => void, ms: number) {
    return { spawn: vi.fn(function (this: unknown, _options: unknown) { advance(ms); return 0; }) };
  }

  it('names the processes started during a stall', () => {
    const { log, lines, advance } = setup();
    const proto = fakeProto(advance, 60);
    log.timeProcessLaunches(proto);
    advance(TICK_MS); log.tick();

    proto.spawn({ file: 'git', args: ['git', 'rev-parse', '--git-dir'] });
    proto.spawn({ file: 'C:\\Windows\\system32\\cmd.exe', args: ['cmd.exe', '/d', '/s', '/c', '"where.exe claude"'] });
    proto.spawn({ file: 'git', args: ['git', '--version'] });
    log.tick();

    expect(lines).toEqual(["main process didn't run for 180 ms; processes started: git rev-parse (60 ms), cmd.exe: where.exe claude (60 ms), git (60 ms)"]);
  });

  it('passes the launch through and records it even when it throws', () => {
    const { log, advance } = setup();
    const proto = { spawn: vi.fn(() => { advance(5); throw new Error('ENOENT'); }) };
    log.timeProcessLaunches(proto);
    expect(() => (proto.spawn as (o: unknown) => unknown)({ file: 'nope', args: ['nope'] })).toThrow('ENOENT');
    expect(log.takeStats()).toMatchObject({ launches: 1, launchMs: 5, slowestLaunch: { name: 'nope', ms: 5 } });
  });

  it('leaves a prototype without spawn alone', () => {
    const { log } = setup();
    const proto = {};
    log.timeProcessLaunches(proto);
    expect(proto).toEqual({});
  });

  it('times real launches through the Node API', async () => {
    const times: string[] = [];
    const log = createFreezeLog({ write: (line) => times.push(line) });
    const original = (ChildProcess.prototype as unknown as { spawn: unknown }).spawn;
    log.timeProcessLaunches(ChildProcess.prototype);
    try {
      await new Promise((resolve) => execFile(process.execPath, ['--version'], resolve));
    } finally {
      (ChildProcess.prototype as unknown as { spawn: unknown }).spawn = original;
    }
    expect(log.takeStats().launches).toBe(1);
  });
});

describe('launchLabel', () => {
  it('names a program and its subcommand or script', () => {
    expect(launchLabel('git', ['git', 'worktree', 'add', '/some/path'])).toBe('git worktree');
    expect(launchLabel('/usr/bin/node', ['node', '/app/cli.js', '--resume'])).toBe('node cli.js');
    expect(launchLabel('C:\\Users\\Jo Smith\\.local\\bin\\claude.exe', ['claude.exe', 'auth'])).toBe('claude.exe auth');
  });

  it('names the program and subcommand a shell runs', () => {
    expect(launchLabel('/bin/sh', ['/bin/sh', '-c', 'git --version'])).toBe('sh: git');
    expect(launchLabel('C:\\Windows\\System32\\cmd.exe', ['cmd.exe', '/d', '/s', '/c', '"claude mcp list"'])).toBe('cmd.exe: claude mcp');
    expect(launchLabel('C:\\Windows\\System32\\cmd.exe', ['cmd.exe', '/d', '/s', '/c', '"where.exe claude"'])).toBe('cmd.exe: where.exe claude');
  });

  it('leaves out anything that could be a name, a folder or text', () => {
    // A path with a space in a shell command.
    expect(launchLabel('C:\\Windows\\System32\\cmd.exe', ['cmd.exe', '/d', '/s', '/c', '"C:\\Users\\John Smith\\AppData\\Roaming\\npm\\claude.cmd auth status --json"']))
      .toBe('cmd.exe: claude.cmd auth');
    expect(launchLabel('C:\\Windows\\System32\\cmd.exe', ['cmd.exe', '/d', '/s', '/c', '"C:\\Program Files\\Git\\bin\\git status"'])).toBe('cmd.exe');
    // A flag's value, which may be a project folder.
    expect(launchLabel('git', ['git', '-C', 'C:\\Users\\sam\\secret-project', 'status'])).toBe('git');
    expect(launchLabel('gh', ['gh', '--repo', 'owner/name', 'pr'])).toBe('gh');
    // Text.
    expect(launchLabel('git', ['git', 'commit message with spaces'])).toBe('git');
    expect(launchLabel(undefined, undefined)).toBe('process');
  });
});

describe('takeStats', () => {
  it('totals stalls, slow frames and launches, then starts again', () => {
    const { log, advance } = setup();
    advance(200); log.tick();
    advance(300); log.tick();
    log.logWindowFreeze({ kind: 'frame', durationMs: 150 });
    expect(log.takeStats()).toEqual({ stalls: 2, stallMs: 500, slowFrames: 1, launches: 0, launchMs: 0, slowestLaunch: null, loopDelay: { p50: 150, p99: 250, max: 250 } });
    expect(log.takeStats()).toEqual({ stalls: 0, stallMs: 0, slowFrames: 0, launches: 0, launchMs: 0, slowestLaunch: null, loopDelay: null });
  });

  it('measures the event-loop delay from how late each tick ran', () => {
    const { log, advance } = setup();
    for (let i = 0; i < 98; i++) { advance(TICK_MS + 1); log.tick(); }
    advance(TICK_MS + 40); log.tick();
    advance(TICK_MS + 400); log.tick();
    expect(log.takeStats().loopDelay).toEqual({ p50: 1, p99: 40, max: 400 });
  });

  it('leaves sleep out of the delay', () => {
    const { log, advance } = setup();
    advance(TICK_MS); log.tick();
    log.suspend();
    advance(60_000); log.tick();
    log.resume();
    advance(45_000); log.tick();
    expect(log.takeStats().loopDelay).toEqual({ p50: 0, p99: 0, max: 0 });
  });
});
