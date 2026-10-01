import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IpcMain } from 'electron';
import { createFreezeLog, sanitizeReport, startStallWatch, STALL_GAP_MS, TICK_MS } from './freeze-log.js';

/** A freeze log on a clock the test moves by hand. */
function setup() {
  let t = 1000;
  const lines: string[] = [];
  const log = createFreezeLog({ now: () => t, warn: (line) => lines.push(line) });
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

  it('logs a gap of at least the stall threshold', () => {
    const { log, lines, advance } = setup();
    advance(420); log.tick();
    expect(lines).toEqual(["[freeze] main process didn't run for 420 ms"]);
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

    expect(lines).toEqual(["[freeze] main process didn't run for 400 ms; IPC calls during it: agent:historyPage (380 ms)"]);
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
    expect(lines).toEqual(["[freeze] main process didn't run for 200 ms; IPC calls during it: session:resume (200 ms)"]);
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
    expect(lines).toEqual(['[freeze] window took 512 ms over a frame (style and layout 180 ms); longest scripts: FrameRequestCallback (index.js:120) 210 ms']);
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
      '[freeze] 5 more freezes in the last minute were not logged',
      "[freeze] main process didn't run for 300 ms",
    ]);
  });
});

describe('startStallWatch', () => {
  it('pauses across system sleep', () => {
    vi.useFakeTimers();
    const on = vi.fn();
    startStallWatch({ on } as never);
    expect(on.mock.calls.map(([event]) => event)).toEqual(['suspend', 'resume']);
  });
});
