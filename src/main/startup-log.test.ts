import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { IpcMain } from 'electron';
import {
  createStartupLog, describeGpuDevices, describeGpuFeatures, describeProcess, exitOutcome,
  HEARTBEAT_MS, KEEP_LAUNCHES, SLOW_MS, STARTUP_LOG_MS,
} from './startup-log.js';

interface FakeTimer { fn: () => void; ms: number; cleared: boolean; unref?: () => void }

let dir: string;
let file: string;
/** Milliseconds since launch, as the log reads them. */
let t: number;
let intervals: FakeTimer[];
let timeouts: FakeTimer[];

const LAUNCH = Date.UTC(2026, 9, 14, 9, 0, 0);

function makeLog() {
  const add = (list: FakeTimer[]) => (fn: () => void, ms: number) => {
    const timer: FakeTimer = { fn, ms, cleared: false };
    list.push(timer);
    return timer;
  };
  const clear = (timer: unknown) => { (timer as FakeTimer).cleared = true; };
  return createStartupLog({
    now: () => t,
    clock: () => new Date(LAUNCH + t),
    setInterval: add(intervals),
    clearInterval: clear,
    setTimeout: add(timeouts),
    clearTimeout: clear,
  });
}

/** Run the heartbeat once. */
function beat(): void {
  for (const timer of intervals) if (!timer.cleared) timer.fn();
}

async function lines(log: ReturnType<typeof makeLog>, of = file): Promise<string[]> {
  await log.flushed();
  return fs.readFileSync(of, 'utf-8').trimEnd().split('\n');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-log-'));
  file = path.join(dir, 'logs', 'startup.log');
  t = 1000;
  intervals = [];
  timeouts = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('startup log', () => {
  it('writes nothing before begin', async () => {
    const log = makeLog();
    log.step('too early');
    log.track('git status')('exit 0');
    await log.flushed();
    expect(fs.existsSync(file)).toBe(false);
    expect(log.active).toBe(false);
  });

  it('writes the header, then each step with its time and the ms since launch', async () => {
    const log = makeLog();
    log.begin({ file, header: ['Grove Bench 1.0.0 starting (pid 42)', 'safe mode off'] });
    t = 1834;
    log.step('window created');

    expect(await lines(log)).toEqual([
      '[2026-10-14T09:00:01.000Z] +1000ms Grove Bench 1.0.0 starting (pid 42)',
      '[2026-10-14T09:00:01.000Z] +1000ms safe mode off',
      '[2026-10-14T09:00:01.834Z] +1834ms window created',
    ]);
    expect(log.active).toBe(true);
  });

  it('keeps the last launches, the one before as startup.log.1', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'launch 4\n');
    for (let i = 1; i < KEEP_LAUNCHES; i++) fs.writeFileSync(`${file}.${i}`, `launch ${4 - i}\n`);

    const log = makeLog();
    log.begin({ file, header: ['launch 5'] });
    expect(await lines(log)).toEqual([expect.stringMatching(/ launch 5$/)]);

    expect(fs.readFileSync(`${file}.1`, 'utf-8')).toBe('launch 4\n');
    expect(fs.readFileSync(`${file}.${KEEP_LAUNCHES - 1}`, 'utf-8')).toBe('launch 1\n');
    expect(fs.readdirSync(path.dirname(file))).toHaveLength(KEEP_LAUNCHES);
  });

  it('notes work starting and ending, and names it in the heartbeat while it runs long', async () => {
    const log = makeLog();
    log.begin({ file, header: [], heartbeat: () => 'memory free 3.1 of 15.7 GB' });
    expect(intervals.map((i) => i.ms)).toEqual([HEARTBEAT_MS]);

    const done = log.track('git status in C:\\work\\app');
    t += 500;
    beat();
    t += SLOW_MS;
    beat();
    done('exit 0');
    done('exit 0');

    expect((await lines(log)).map((l) => l.replace(/^\[[^\]]+\] \+\d+ms /, ''))).toEqual([
      'start git status in C:\\work\\app',
      'alive; memory free 3.1 of 15.7 GB; nothing running long',
      'alive; memory free 3.1 of 15.7 GB; running: git status in C:\\work\\app (2.5 s)',
      'exit 0: git status in C:\\work\\app after 2500 ms',
    ]);
  });

  it('notes quiet work only when it was slow', async () => {
    const log = makeLog();
    log.begin({ file, header: ['header'] });
    log.track('ipc fast', { quiet: true })('failed');
    const slow = log.track('ipc slow', { quiet: true });
    t += SLOW_MS;
    slow();

    expect((await lines(log)).slice(1)).toEqual([expect.stringMatching(/ \+3000ms done: ipc slow after 2000 ms$/)]);
  });

  it('leaves out a heartbeat part that throws', async () => {
    const log = makeLog();
    log.begin({ file, header: [], heartbeat: () => { throw new Error('no metrics yet'); } });
    beat();
    expect(await lines(log)).toEqual([expect.stringMatching(/ alive; nothing running long$/)]);
  });

  it('ends after STARTUP_LOG_MS and writes nothing more', async () => {
    const log = makeLog();
    log.begin({ file, header: ['header'] });
    const end = timeouts.find((timer) => timer.ms === STARTUP_LOG_MS);
    expect(end).toBeDefined();

    t += STARTUP_LOG_MS;
    end!.fn();
    log.step('after the end');
    expect(log.track('git status')).toBeTypeOf('function');

    const written = await lines(log);
    expect(written.at(-1)).toMatch(/ startup log ends here \(5 min after launch\)$/);
    expect(written).toHaveLength(2);
    expect(intervals.every((timer) => timer.cleared)).toBe(true);
    expect(log.active).toBe(false);
  });

  it('never throws when the logs folder cannot be written', async () => {
    fs.writeFileSync(path.join(dir, 'blocker'), '');
    file = path.join(dir, 'blocker', 'startup.log');
    const log = makeLog();
    expect(() => {
      log.begin({ file, header: ['header'] });
      log.step('one');
    }).not.toThrow();
    await log.flushed();
    expect(() => log.step('two')).not.toThrow();
    await log.flushed();
  });

  describe('process launches', () => {
    class FakeChild extends EventEmitter {
      spawn(options: { fail?: boolean }): number {
        return options.fail ? -2 : 0;
      }
    }

    it('notes each start and exit, with the folder it ran in', async () => {
      const log = makeLog();
      log.watchProcessLaunches(FakeChild.prototype);
      const before = new FakeChild();
      expect(before.spawn({ file: 'git', args: ['git', 'status'] } as never)).toBe(0);

      log.begin({ file, header: ['header'] });
      const child = new FakeChild();
      child.spawn({ file: 'git', args: ['git', 'status', '--porcelain'], cwd: 'C:\\work\\app' } as never);
      t += 120;
      child.emit('exit', 0, null);
      const failed = new FakeChild();
      expect(failed.spawn({ file: 'gh', args: ['gh', 'auth'], fail: true } as never)).toBe(-2);

      expect((await lines(log)).slice(1).map((l) => l.replace(/^\[[^\]]+\] \+\d+ms /, ''))).toEqual([
        'start git status in C:\\work\\app',
        'exit 0: git status in C:\\work\\app after 120 ms',
        'start gh auth',
        'failed to start: gh auth after 0 ms',
      ]);
      // An 'error' listener would swallow errors nothing else handles.
      expect(child.listenerCount('error')).toBe(0);
    });
  });

  describe('IPC handlers', () => {
    it('notes a call that ran long, and passes results through unchanged', async () => {
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const ipc = { handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener); } };
      const log = makeLog();
      log.watchIpcHandlers(ipc as unknown as Pick<IpcMain, 'handle'>);
      log.begin({ file, header: ['header'] });

      let finish!: (value: string) => void;
      ipc.handle('session:resume', () => new Promise<string>((resolve) => { finish = resolve; }));
      ipc.handle('win:isMaximized', () => false);

      const pending = handlers.get('session:resume')!({}, 'id') as Promise<string>;
      expect(handlers.get('win:isMaximized')!({})).toBe(false);
      t += SLOW_MS + 100;
      finish('resumed');
      await expect(pending).resolves.toBe('resumed');

      expect((await lines(log)).slice(1)).toEqual([expect.stringMatching(/ done: ipc session:resume after 2100 ms$/)]);
    });
  });
});

describe('describeGpuDevices', () => {
  it('names the card in use first, with its driver', () => {
    expect(describeGpuDevices({
      gpuDevice: [
        { active: false, vendorId: 0x8086, deviceId: 0x9a49 },
        { active: true, vendorId: 0x10de, deviceId: 0x25a2, driverVersion: '31.0.15.3623' },
        { active: false, vendorId: 0x1234, deviceId: 0x1 },
      ],
    })).toBe('NVIDIA device 0x25a2, driver 31.0.15.3623 (in use); Intel device 0x9a49; 0x1234 device 0x0001');
  });

  it('says so when there is nothing to name', () => {
    expect(describeGpuDevices({})).toBe('none reported');
    expect(describeGpuDevices(null)).toBe('none reported');
  });
});

describe('describeGpuFeatures', () => {
  it('lists what the window draws with', () => {
    expect(describeGpuFeatures({ gpu_compositing: 'disabled_software', rasterization: 'disabled_software', webgl: 'unavailable_off' }))
      .toBe('compositing disabled_software, rasterization disabled_software, webgl unavailable_off');
  });
});

describe('describeProcess and exitOutcome', () => {
  it('adds the folder, and says how it ended', () => {
    expect(describeProcess('git status', 'C:\\work')).toBe('git status in C:\\work');
    expect(describeProcess('git status', undefined)).toBe('git status');
    expect(exitOutcome(1, null)).toBe('exit 1');
    expect(exitOutcome(null, 'SIGTERM')).toBe('stopped (SIGTERM)');
    expect(exitOutcome(null, null)).toBe('ended');
  });
});
