/**
 * Freeze log: notes in the performance log (perf-log.ts) when the app
 * stopped responding, so a freeze someone reports can be traced to its
 * cause afterwards.
 *
 * Two places can freeze the whole window. The main process passes input to
 * the window, so while its event loop is blocked nothing responds; a timer
 * here that should run every TICK_MS notices when it ran late, and names
 * the IPC calls and process launches that ran meanwhile. And the window
 * itself can take long over a frame; it reports those frames (see
 * renderer/lib/freeze-watch.ts) and they are written here.
 *
 * Launching a process blocks the main process until the OS has created it,
 * which on Windows can take tens of milliseconds, so every launch is timed.
 */
import type { IpcMain, PowerMonitor } from 'electron';
import type { FreezeReport } from '../shared/types.js';
import { perfLine } from './perf-log.js';

/** How often the main-process timer runs. */
export const TICK_MS = 50;
/** Log a stall when the timer's runs are this far apart: the event loop
 *  was blocked for at least STALL_GAP_MS - TICK_MS (100 ms). */
export const STALL_GAP_MS = 150;
/** A gap this long is a system sleep the suspend event missed, not a freeze. */
const SLEEP_GAP_MS = 30_000;
/** At most this many freeze lines a minute, so a bad state can't flood the log. */
const MAX_LINES_PER_MINUTE = 30;
/** IPC calls and process launches remembered, to name the ones that ran
 *  during a stall. */
const RECENT = 32;

/** Something that ran on the main process: an IPC handler or a launch. */
interface Activity {
  name: string;
  start: number;
  /** Time it held the main process (an IPC handler: until it returned or
   *  reached its first await; a launch: until the OS created the process). */
  ms: number;
}

/** Totals since the last health line (see perf-health.ts). */
export interface FreezeStats {
  stalls: number;
  stallMs: number;
  slowFrames: number;
  launches: number;
  launchMs: number;
  slowestLaunch: { name: string; ms: number } | null;
  /** How late the timer ran: the main process's event-loop delay, in ms.
   *  Null when it didn't run. */
  loopDelay: { p50: number; p99: number; max: number } | null;
}

const emptyStats = (): Omit<FreezeStats, 'loopDelay'> => ({ stalls: 0, stallMs: 0, slowFrames: 0, launches: 0, launchMs: 0, slowestLaunch: null });

/** The nearest-rank percentile `p` (0 to 1) of ascending `sorted`. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

export interface FreezeLogOptions {
  /** Monotonic clock in ms. */
  now?: () => number;
  write?: (line: string) => void;
}

/** Shells a process may be launched through (`shell: true`); the command
 *  they run says more than the shell's name. */
const SHELLS = new Set(['cmd.exe', 'cmd', 'sh', 'bash', 'powershell.exe', 'pwsh.exe']);

/** A short, safe word from an argument: a path's last part, and nothing
 *  that could carry a message, a token or other text. */
function launchWord(arg: string): string | null {
  const word = arg.replace(/["']/g, '').split(/[\\/]/).pop() ?? '';
  return /^[\w.@+:-]{1,40}$/.test(word) ? word : null;
}

/** How a launch is named in the log: the program and its first argument
 *  (a git subcommand, a script), or for a shell the command it runs. */
export function launchLabel(file: unknown, args: unknown): string {
  const name = typeof file === 'string' ? (file.split(/[\\/]/).pop() || file) : 'process';
  const rest = Array.isArray(args) ? args.slice(1).filter((a): a is string => typeof a === 'string') : [];
  if (SHELLS.has(name.toLowerCase())) {
    const flag = rest.findIndex((a) => /^([/-]c|-command)$/i.test(a));
    const words = (flag >= 0 ? rest.slice(flag + 1).join(' ') : '')
      .replace(/["']/g, '').trim().split(/\s+/)
      .map(launchWord).filter((w): w is string => !!w).slice(0, 2);
    return words.length > 0 ? `${name}: ${words.join(' ')}` : name;
  }
  const first = rest.find((a) => !a.startsWith('-'));
  const word = first ? launchWord(first) : null;
  return word ? `${name} ${word}` : name;
}

export function createFreezeLog({ now = () => performance.now(), write = (line) => perfLine('freeze', line) }: FreezeLogOptions = {}) {
  let lastTick = now();
  let suspended = false;
  const ipcCalls: Activity[] = [];
  const launches: Activity[] = [];
  let stats = emptyStats();
  /** How late each tick ran since the last takeStats (about 12,000 for ten
   *  minutes); the health line's event-loop delay comes from these, so it
   *  needs no timer of its own. */
  let delays: number[] = [];
  let windowStart = now();
  let linesThisWindow = 0;
  let dropped = 0;

  function remember(list: Activity[], item: Activity): void {
    list.push(item);
    if (list.length > RECENT) list.shift();
  }

  function emit(line: string): void {
    const t = now();
    if (t - windowStart >= 60_000) {
      if (dropped > 0) write(`${dropped} more freezes in the last minute were not logged`);
      windowStart = t;
      linesThisWindow = 0;
      dropped = 0;
    }
    if (linesThisWindow >= MAX_LINES_PER_MINUTE) {
      dropped++;
      return;
    }
    linesThisWindow++;
    write(line);
  }

  /** Run TICK_MS apart. Logs a stall when this run comes late. */
  function tick(): void {
    const t = now();
    const gap = t - lastTick;
    lastTick = t;
    if (suspended || gap >= SLEEP_GAP_MS) return;
    delays.push(Math.max(0, gap - TICK_MS));
    if (gap < STALL_GAP_MS) return;
    stats.stalls++;
    stats.stallMs += gap;
    const from = t - gap;
    const during = (list: Activity[]) => list
      .filter((c) => c.start >= from - 1 && c.start <= t)
      .map((c) => `${c.name} (${Math.round(c.ms)} ms)`)
      .join(', ');
    const ipc = during(ipcCalls);
    const launched = during(launches);
    emit(`main process didn't run for ${Math.round(gap)} ms`
      + (ipc ? `; IPC calls during it: ${ipc}` : '')
      + (launched ? `; processes started: ${launched}` : ''));
  }

  /** Time every process launch from now on (all of them go through
   *  `ChildProcess.prototype.spawn`: spawn, execFile, execa). That method
   *  isn't documented, so where it's missing launches go untimed. */
  function timeProcessLaunches(proto: object): void {
    const target = proto as { spawn?: (this: unknown, options: unknown) => unknown };
    const original = target.spawn;
    if (typeof original !== 'function') return;
    target.spawn = function (this: unknown, options: unknown) {
      const start = now();
      try {
        return original.call(this, options);
      } finally {
        const ms = now() - start;
        const opts = (options ?? {}) as { file?: unknown; args?: unknown };
        const name = launchLabel(opts.file, opts.args);
        remember(launches, { name, start, ms });
        stats.launches++;
        stats.launchMs += ms;
        if (!stats.slowestLaunch || ms > stats.slowestLaunch.ms) stats.slowestLaunch = { name, ms };
      }
    };
  }

  /** Time the synchronous part of every handler registered with
   *  `ipc.handle` from now on, so a stall can name the calls it covered. */
  function timeIpcHandlers(ipc: Pick<IpcMain, 'handle'>): void {
    const handle = ipc.handle.bind(ipc);
    ipc.handle = (channel: string, listener: Parameters<IpcMain['handle']>[1]) => handle(channel, (event, ...args) => {
      const start = now();
      try {
        return listener(event, ...args);
      } finally {
        remember(ipcCalls, { name: channel, start, ms: now() - start });
      }
    });
  }

  /** Write a slow frame (or task) the window reported. */
  function logWindowFreeze(report: unknown): void {
    const r = sanitizeReport(report);
    if (!r) return;
    stats.slowFrames++;
    const parts = [`window took ${Math.round(r.durationMs)} ms over a ${r.kind}`];
    if (r.renderMs !== undefined) parts.push(`(style and layout ${Math.round(r.renderMs)} ms)`);
    let line = parts.join(' ');
    if (r.scripts && r.scripts.length > 0) line += `; longest scripts: ${r.scripts.join('; ')}`;
    emit(line);
  }

  return {
    tick,
    timeIpcHandlers,
    timeProcessLaunches,
    logWindowFreeze,
    /** The totals since the last call, for the health line. */
    takeStats(): FreezeStats {
      const sorted = delays.sort((a, b) => a - b);
      const loopDelay = sorted.length > 0
        ? { p50: percentile(sorted, 0.5), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1] }
        : null;
      const taken = { ...stats, loopDelay };
      stats = emptyStats();
      delays = [];
      return taken;
    },
    /** Start (or restart) the clock the next tick is measured from. */
    start(): void { suspended = false; lastTick = now(); },
    /** The system is going to sleep: the timer stops, that's not a freeze. */
    suspend(): void { suspended = true; },
    resume(): void { suspended = false; lastTick = now(); },
  };
}

/** A FreezeReport from the window, with every field checked, or null. */
export function sanitizeReport(value: unknown): FreezeReport | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 3_600_000) : undefined);
  const durationMs = ms(r.durationMs);
  if (durationMs === undefined || (r.kind !== 'frame' && r.kind !== 'task')) return null;
  const renderMs = ms(r.renderMs);
  const scripts = Array.isArray(r.scripts)
    ? r.scripts.filter((s): s is string => typeof s === 'string').slice(0, 5).map((s) => s.replace(/[\r\n]+/g, ' ').slice(0, 200))
    : undefined;
  return {
    kind: r.kind,
    durationMs,
    ...(renderMs !== undefined ? { renderMs } : {}),
    ...(scripts && scripts.length > 0 ? { scripts } : {}),
  };
}

export const freezeLog = createFreezeLog();

/** Start the main-process timer. Call once the app is ready (it listens to
 *  power events, which need that). */
export function startStallWatch(powerMonitor: Pick<PowerMonitor, 'on'>): void {
  // From now, not from when this file loaded: the wait for the app to be
  // ready isn't a freeze.
  freezeLog.start();
  const timer = setInterval(freezeLog.tick, TICK_MS);
  timer.unref?.();
  powerMonitor.on('suspend', freezeLog.suspend);
  powerMonitor.on('resume', freezeLog.resume);
}
