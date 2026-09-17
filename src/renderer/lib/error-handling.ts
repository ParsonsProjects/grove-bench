/**
 * Global error handling for the renderer.
 *
 * `window.onerror` / `unhandledrejection` catch what Svelte's error boundary
 * cannot (event handlers, timers, IPC callbacks). Each error becomes an
 * AppErrorReport that App.svelte shows as a toast, sends to main for the
 * file log, and (opt-in) forwards to crash reporting.
 */
import type { AppErrorReport } from '../../shared/types.js';

const MESSAGE_MAX = 200;
const DEDUPE_WINDOW_MS = 5_000;

function describe(payload: unknown): { message: string; stack?: string } {
  if (payload instanceof Error) {
    return { message: payload.message || payload.name || 'Error', stack: payload.stack };
  }
  if (typeof payload === 'string') return { message: payload };
  if (payload && typeof payload === 'object') {
    const maybe = payload as { message?: unknown; stack?: unknown; reason?: unknown };
    if (typeof maybe.message === 'string') {
      return { message: maybe.message, stack: typeof maybe.stack === 'string' ? maybe.stack : undefined };
    }
  }
  return { message: String(payload) };
}

/** Build a report from whatever was thrown/rejected. */
export function reportFromError(
  kind: string,
  payload: unknown,
  sessionId?: string,
  now = Date.now(),
): AppErrorReport {
  const { message, stack } = describe(payload);
  return {
    source: 'renderer',
    kind,
    message,
    ...(stack ? { stack } : {}),
    ...(sessionId ? { sessionId } : {}),
    timestamp: now,
  };
}

/** One-line toast text. */
export function shortMessage(report: AppErrorReport): string {
  const where = report.source === 'main' ? 'Background error' : 'Unexpected error';
  const msg = report.message.replace(/\s+/g, ' ').trim() || 'unknown';
  const text = `${where}: ${msg}`;
  return text.length > MESSAGE_MAX ? text.slice(0, MESSAGE_MAX - 1) + '…' : text;
}

/** Drops repeats of the same message inside a short window so a tight loop
 *  produces one toast and one log line, not hundreds. */
export class ErrorDeduper {
  private last = new Map<string, number>();
  constructor(private readonly windowMs = DEDUPE_WINDOW_MS) {}

  /** True when this report should be handled (first time, or window expired). */
  accept(report: AppErrorReport): boolean {
    const key = `${report.source}:${report.kind}:${report.message}`;
    const prev = this.last.get(key);
    if (prev !== undefined && report.timestamp - prev < this.windowMs) return false;
    this.last.set(key, report.timestamp);
    // Keep the map small
    if (this.last.size > 100) {
      for (const [k, t] of this.last) {
        if (report.timestamp - t >= this.windowMs) this.last.delete(k);
      }
    }
    return true;
  }
}

/** Hook window error events. Returns an uninstall function. */
export function installRendererErrorHandlers(onReport: (report: AppErrorReport) => void): () => void {
  const onError = (e: ErrorEvent) => {
    // ResizeObserver loop warnings are benign browser noise, not app bugs.
    if (typeof e.message === 'string' && e.message.startsWith('ResizeObserver loop')) return;
    onReport(reportFromError('error', e.error ?? e.message));
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    onReport(reportFromError('unhandledrejection', e.reason));
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
