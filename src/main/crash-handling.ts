/**
 * Global error handling for the main process.
 *
 * Without these handlers an uncaught exception shows Electron's generic
 * "A JavaScript error occurred in the main process" dialog and kills the app,
 * taking every agent session with it. Instead we log the error to the file
 * log, forward it to the renderer (toast + optional crash report), and keep
 * running: a stray rejection in one session's git call is not a reason to
 * drop the other sessions.
 */
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { AppErrorReport } from '../shared/types.js';
import { logger } from './logger.js';

/** Forwarding is rate-limited so a tight error loop can't flood the renderer. */
const FORWARD_WINDOW_MS = 60_000;
const FORWARD_MAX_PER_WINDOW = 20;

/** Message + stack for anything `throw`n or rejected with. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Error', stack: err.stack };
  }
  if (typeof err === 'string') return { message: err };
  if (err && typeof err === 'object') {
    const maybe = err as { message?: unknown; stack?: unknown };
    if (typeof maybe.message === 'string') {
      return { message: maybe.message, stack: typeof maybe.stack === 'string' ? maybe.stack : undefined };
    }
    try { return { message: JSON.stringify(err) }; } catch { /* fall through */ }
  }
  return { message: String(err) };
}

export function buildReport(kind: string, err: unknown, source: AppErrorReport['source'] = 'main', now = Date.now()): AppErrorReport {
  const { message, stack } = describeError(err);
  return { source, kind, message, ...(stack ? { stack } : {}), timestamp: now };
}

/** Sliding-window limiter. Exported for tests. */
export class ForwardLimiter {
  private stamps: number[] = [];
  constructor(private readonly max = FORWARD_MAX_PER_WINDOW, private readonly windowMs = FORWARD_WINDOW_MS) {}
  allow(now = Date.now()): boolean {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }
}

export interface ProcessErrorHandlerOptions {
  getWindow: () => BrowserWindow | null;
  /** Injected for tests; defaults to the real `process`. */
  proc?: Pick<NodeJS.Process, 'on'>;
  limiter?: ForwardLimiter;
}

/** Log a report and forward it to the renderer (subject to the limiter). */
export function handleMainError(
  report: AppErrorReport,
  getWindow: () => BrowserWindow | null,
  limiter: ForwardLimiter,
): void {
  logger.error(`[${report.kind}] ${report.message}`, report.stack ?? '');
  if (!limiter.allow(report.timestamp)) return;
  try {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.APP_ERROR, report);
    }
  } catch (e) {
    // Never let the error handler itself throw.
    logger.warn('Failed to forward main-process error to renderer:', e);
  }
}

/** Log a renderer-reported error to the file log (the renderer already
 *  showed it). */
export function logRendererError(report: AppErrorReport): void {
  const where = report.sessionId ? ` session=${report.sessionId}` : '';
  logger.error(`[renderer:${report.kind}${where}] ${report.message}`, report.stack ?? '');
}

/** Install `uncaughtException` / `unhandledRejection` handlers. Idempotent
 *  per `proc`. */
export function installProcessErrorHandlers(opts: ProcessErrorHandlerOptions): void {
  const proc = opts.proc ?? process;
  const limiter = opts.limiter ?? new ForwardLimiter();
  proc.on('uncaughtException', (err: unknown) => {
    handleMainError(buildReport('uncaughtException', err), opts.getWindow, limiter);
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    handleMainError(buildReport('unhandledRejection', reason), opts.getWindow, limiter);
  });
}
