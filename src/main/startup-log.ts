/**
 * Startup log: startup.log in the logs folder, for a launch that freezes the
 * whole computer, so that it only comes back by holding the power button.
 * The app log and the performance log are buffered (rotating-log.ts), and
 * their last lines can be lost with the buffer. Here each line is flushed to
 * the disk (fsync) as it is written, so after the restart the file ends at
 * the last thing Grove did.
 *
 * It covers the first STARTUP_LOG_MS of a launch: its steps (window, restore,
 * cleanup), every process started and when it ended, and every HEARTBEAT_MS a
 * line saying the main process still runs, with memory and what has been
 * running for a while. The last KEEP_LAUNCHES launches are kept, so the launch
 * that froze is still there (as startup.log.1) after the next one. Writing
 * happens off the main process's thread: a stalled disk must not stall the
 * window. It never leaves this computer.
 *
 *   [2026-10-14T09:52:01.120Z] +1834ms window created
 *   [2026-10-14T09:52:01.410Z] +2124ms start git worktree list in C:\work\app
 *   [2026-10-14T09:52:06.002Z] +6716ms alive; memory free 3.1 of 15.7 GB; running: git worktree list in C:\work\app (4.6 s)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { launchLabel } from './freeze-log.js';

/** How long after launch the log is kept up. */
export const STARTUP_LOG_MS = 5 * 60_000;
/** How often a line says the main process still runs. */
export const HEARTBEAT_MS = 5_000;
/** Work running this long is named in the heartbeat; quiet work that took
 *  this long gets a line when it ends. */
export const SLOW_MS = 2_000;
/** startup.log and startup.log.1 to .4. */
export const KEEP_LAUNCHES = 5;
/** At most this many running things named in one heartbeat, oldest first. */
const MAX_NAMED = 8;

type Timer = { unref?: () => void };

export interface StartupLogDeps {
  /** Milliseconds since the process started. */
  now?: () => number;
  /** The time stamped on each line. */
  clock?: () => Date;
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (timer: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (timer: unknown) => void;
}

export interface StartupLogOptions {
  file: string;
  /** Lines at the top: version, system, safe mode. */
  header: string[];
  /** Added to each heartbeat, such as free memory. Never throws through. */
  heartbeat?: () => string;
}

export interface TrackOptions {
  /** No line when it starts, and one when it ends only if it was slow. For
   *  frequent calls (IPC), named in the heartbeat while they run long. */
  quiet?: boolean;
}

/** Ends tracked work. `outcome` says how ("failed", "exit 1"). */
export type Done = (outcome?: string) => void;

const noop: Done = () => {};

export function createStartupLog(deps: StartupLogDeps = {}) {
  const now = deps.now ?? (() => performance.now());
  const clock = deps.clock ?? (() => new Date());
  const every = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopEvery = deps.clearInterval ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const after = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const stopAfter = deps.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let state: 'idle' | 'active' | 'ended' = 'idle';
  let file = '';
  let heartbeatExtra: (() => string) | undefined;
  let heartbeat: unknown = null;
  let endTimer: unknown = null;
  /** Lines waiting to be written. */
  let queue: string[] = [];
  let handle: fs.FileHandle | null = null;
  let rotated = false;
  /** Set once writing has failed: the rest is dropped, not retried. */
  let broken = false;
  let writing: Promise<void> | null = null;
  let nextId = 0;
  const running = new Map<number, { label: string; start: number }>();

  function line(text: string): void {
    if (state !== 'active' || broken) return;
    queue.push(`[${clock().toISOString()}] +${Math.round(now())}ms ${text}\n`);
    write();
  }

  /** Write what's queued, one batch at a time, each flushed to the disk. */
  function write(): void {
    if (writing) return;
    writing = (async () => {
      try {
        while (queue.length > 0) {
          if (!handle) {
            await fs.mkdir(path.dirname(file), { recursive: true });
            if (!rotated) {
              rotated = true;
              await rotate(file);
            }
            handle = await fs.open(file, 'a');
          }
          const batch = queue.join('');
          queue = [];
          await handle.write(batch);
          await handle.sync();
        }
        if (state === 'ended') await closeFile();
      } catch {
        // The logs folder can't be written: logging must not break the app.
        broken = true;
        queue = [];
        await closeFile();
      } finally {
        writing = null;
        if (queue.length > 0 && !broken) write();
      }
    })();
  }

  async function closeFile(): Promise<void> {
    const h = handle;
    handle = null;
    try { await h?.close(); } catch { /* already gone */ }
  }

  /** What has been running at least SLOW_MS, oldest first. */
  function longRunning(): string[] {
    const t = now();
    return [...running.values()]
      .filter((r) => t - r.start >= SLOW_MS)
      .sort((a, b) => a.start - b.start)
      .slice(0, MAX_NAMED)
      .map((r) => `${r.label} (${((t - r.start) / 1000).toFixed(1)} s)`);
  }

  function beat(): void {
    let extra = '';
    try {
      extra = heartbeatExtra?.() ?? '';
    } catch { /* leave it out */ }
    const named = longRunning();
    line(['alive', extra, named.length > 0 ? `running: ${named.join(', ')}` : 'nothing running long'].filter(Boolean).join('; '));
  }

  /** Work that has started (a process, a cleanup). Call what it returns when
   *  it ends; until then the heartbeat names it once it runs long. */
  function track(label: string, options: TrackOptions = {}): Done {
    if (state !== 'active') return noop;
    const id = ++nextId;
    const start = now();
    running.set(id, { label, start });
    if (!options.quiet) line(`start ${label}`);
    return (outcome?: string) => {
      if (!running.delete(id)) return;
      const ms = Math.round(now() - start);
      if (options.quiet && ms < SLOW_MS) return;
      line(`${outcome ?? 'done'}: ${label} after ${ms} ms`);
    };
  }

  /** Stop logging this launch (quit, or STARTUP_LOG_MS passed). */
  function end(reason: string): void {
    if (state !== 'active') return;
    line(`startup log ends here (${reason})`);
    state = 'ended';
    stopEvery(heartbeat);
    stopAfter(endTimer);
    running.clear();
    if (!writing) void closeFile();
  }

  return {
    /** Start this launch's log. Once per launch; later calls do nothing. */
    begin(options: StartupLogOptions): void {
      if (state !== 'idle') return;
      state = 'active';
      file = options.file;
      heartbeatExtra = options.heartbeat;
      for (const text of options.header) line(text);
      const beatTimer = every(beat, HEARTBEAT_MS);
      beatTimer.unref?.();
      heartbeat = beatTimer;
      const stop = after(() => end(`${Math.round(STARTUP_LOG_MS / 60_000)} min after launch`), STARTUP_LOG_MS);
      stop.unref?.();
      endTimer = stop;
    },

    /** A step of the launch. */
    step(text: string): void {
      line(text);
    },

    track,
    end,

    /** Whether this launch is being logged. */
    get active(): boolean {
      return state === 'active';
    },

    /** Log every process the main process starts from `proto`
     *  (ChildProcess.prototype): its start, and its exit. */
    watchProcessLaunches(proto: object): void {
      const target = proto as { spawn?: (this: unknown, options: unknown) => unknown };
      const original = target.spawn;
      if (typeof original !== 'function') return;
      target.spawn = function (this: unknown, options: unknown) {
        if (state !== 'active') return original.call(this, options);
        const opts = (options ?? {}) as { file?: unknown; args?: unknown; cwd?: unknown };
        const done = track(describeProcess(launchLabel(opts.file, opts.args), opts.cwd));
        // No 'error' listener: one would swallow errors nothing else handles.
        const child = this as { once?: (event: string, listener: (...args: unknown[]) => void) => void };
        child.once?.('exit', (code, signal) => done(exitOutcome(code, signal)));
        let result: unknown;
        try {
          result = original.call(this, options);
        } catch (e) {
          done('failed to start');
          throw e;
        }
        // Node returns an error code, rather than throwing, when the OS
        // couldn't start it (ENOENT, EACCES); 'exit' may not follow.
        if (typeof result === 'number' && result !== 0) done('failed to start');
        return result;
      };
    },

    /** Note IPC calls from the window that run long: named in the heartbeat
     *  while they do, and a line when they end. */
    watchIpcHandlers(ipc: Pick<IpcMain, 'handle'>): void {
      const handle = ipc.handle.bind(ipc);
      ipc.handle = (channel, listener) => handle(channel, (event, ...args) => {
        const done = track(`ipc ${channel}`, { quiet: true });
        let result: unknown;
        try {
          result = listener(event, ...args);
        } catch (e) {
          done('failed');
          throw e;
        }
        if (result instanceof Promise) result.then(() => done(), () => done('failed'));
        else done();
        return result;
      });
    },

    /** Resolves once everything logged so far is on the disk (or dropped). */
    async flushed(): Promise<void> {
      while (writing) await writing;
    },
  };
}

export type StartupLog = ReturnType<typeof createStartupLog>;

/** `label`, with the folder it runs in when there is one. */
export function describeProcess(label: string, cwd: unknown): string {
  return typeof cwd === 'string' && cwd ? `${label} in ${cwd}` : label;
}

/** How a process ended, for the line that says so. */
export function exitOutcome(code: unknown, signal: unknown): string {
  if (typeof code === 'number') return `exit ${code}`;
  if (typeof signal === 'string') return `stopped (${signal})`;
  return 'ended';
}

/** What Chromium draws with the GPU (app.getGPUFeatureStatus()): "enabled",
 *  or "disabled_software" and the like when it draws without it. */
export function describeGpuFeatures(status: { gpu_compositing?: string; rasterization?: string; webgl?: string }): string {
  return `compositing ${status.gpu_compositing ?? '?'}, rasterization ${status.rasterization ?? '?'}, webgl ${status.webgl ?? '?'}`;
}

const GPU_VENDORS: Record<number, string> = {
  0x8086: 'Intel',
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x1414: 'Microsoft',
  0x5143: 'Qualcomm',
};

/** The graphics cards in app.getGPUInfo('basic'), the one in use first:
 *  maker, device id and driver version where Chromium reports them. */
export function describeGpuDevices(info: unknown): string {
  const devices = (info as { gpuDevice?: unknown } | null)?.gpuDevice;
  if (!Array.isArray(devices) || devices.length === 0) return 'none reported';
  const hex = (n: unknown) => (typeof n === 'number' ? `0x${n.toString(16).padStart(4, '0')}` : '?');
  return devices
    .map((d: { active?: unknown; vendorId?: unknown; deviceId?: unknown; driverVersion?: unknown }) => {
      const maker = typeof d.vendorId === 'number' ? GPU_VENDORS[d.vendorId] ?? hex(d.vendorId) : '?';
      const driver = typeof d.driverVersion === 'string' && d.driverVersion ? `, driver ${d.driverVersion}` : '';
      return { active: d.active === true, text: `${maker} device ${hex(d.deviceId)}${driver}${d.active === true ? ' (in use)' : ''}` };
    })
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((d) => d.text)
    .join('; ');
}

/** startup.log → startup.log.1 → ... → startup.log.(KEEP_LAUNCHES - 1). */
async function rotate(file: string): Promise<void> {
  for (let i = KEEP_LAUNCHES - 1; i >= 1; i--) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    try { await fs.rename(from, `${file}.${i}`); } catch { /* not there yet */ }
  }
}

/** This launch's startup log. Nothing is written until begin(). */
export const startupLog = createStartupLog();
