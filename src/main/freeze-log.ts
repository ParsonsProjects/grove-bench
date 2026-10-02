/**
 * Freeze log: notes in the log file when the app stopped responding, so a
 * freeze someone reports can be traced to its cause afterwards.
 *
 * Two places can freeze the whole window. The main process passes input to
 * the window, so while its event loop is blocked nothing responds; a timer
 * here that should run every TICK_MS notices when it ran late. And the
 * window itself can take long over a frame; it reports those frames (see
 * renderer/lib/freeze-watch.ts) and they are written here.
 *
 * The timestamps line up with the rest of the log ("Resuming session",
 * "Creating session"), which says what the user was doing at the time.
 */
import type { IpcMain, PowerMonitor } from 'electron';
import type { FreezeReport } from '../shared/types.js';
import { logger } from './logger.js';

/** How often the main-process timer runs. */
export const TICK_MS = 50;
/** Log a stall when the timer's runs are this far apart: the event loop
 *  was blocked for at least STALL_GAP_MS - TICK_MS (100 ms). */
export const STALL_GAP_MS = 150;
/** A gap this long is a system sleep the suspend event missed, not a freeze. */
const SLEEP_GAP_MS = 30_000;
/** At most this many freeze lines a minute, so a bad state can't flood the log. */
const MAX_LINES_PER_MINUTE = 30;
/** IPC calls remembered to name the ones that ran during a stall. */
const RECENT_IPC = 32;

interface IpcCall {
  channel: string;
  start: number;
  /** Time the handler ran before returning (or reaching its first await). */
  syncMs: number;
}

export interface FreezeLogOptions {
  /** Monotonic clock in ms. */
  now?: () => number;
  warn?: (line: string) => void;
}

export function createFreezeLog({ now = () => performance.now(), warn = (line) => logger.warn(line) }: FreezeLogOptions = {}) {
  let lastTick = now();
  let suspended = false;
  const recent: IpcCall[] = [];
  let windowStart = now();
  let linesThisWindow = 0;
  let dropped = 0;

  function emit(line: string): void {
    const t = now();
    if (t - windowStart >= 60_000) {
      if (dropped > 0) warn(`[freeze] ${dropped} more freezes in the last minute were not logged`);
      windowStart = t;
      linesThisWindow = 0;
      dropped = 0;
    }
    if (linesThisWindow >= MAX_LINES_PER_MINUTE) {
      dropped++;
      return;
    }
    linesThisWindow++;
    warn(line);
  }

  /** Run TICK_MS apart. Logs a stall when this run comes late. */
  function tick(): void {
    const t = now();
    const gap = t - lastTick;
    lastTick = t;
    if (suspended || gap < STALL_GAP_MS || gap >= SLEEP_GAP_MS) return;
    const from = t - gap;
    const during = recent.filter((c) => c.start >= from - 1 && c.start <= t);
    const ipc = during.length > 0
      ? `; IPC calls during it: ${during.map((c) => `${c.channel} (${Math.round(c.syncMs)} ms)`).join(', ')}`
      : '';
    emit(`[freeze] main process didn't run for ${Math.round(gap)} ms${ipc}`);
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
        recent.push({ channel, start, syncMs: now() - start });
        if (recent.length > RECENT_IPC) recent.shift();
      }
    });
  }

  /** Write a slow frame (or task) the window reported. */
  function logWindowFreeze(report: unknown): void {
    const r = sanitizeReport(report);
    if (!r) return;
    const parts = [`[freeze] window took ${Math.round(r.durationMs)} ms over a ${r.kind}`];
    if (r.renderMs !== undefined) parts.push(`(style and layout ${Math.round(r.renderMs)} ms)`);
    let line = parts.join(' ');
    if (r.scripts && r.scripts.length > 0) line += `; longest scripts: ${r.scripts.join('; ')}`;
    emit(line);
  }

  return {
    tick,
    timeIpcHandlers,
    logWindowFreeze,
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
  const timer = setInterval(freezeLog.tick, TICK_MS);
  timer.unref?.();
  powerMonitor.on('suspend', freezeLog.suspend);
  powerMonitor.on('resume', freezeLog.resume);
}
