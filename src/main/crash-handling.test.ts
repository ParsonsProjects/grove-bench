import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import { describeError, buildReport, ForwardLimiter, handleMainError, installProcessErrorHandlers, logRendererError } from './crash-handling.js';
import { logger } from './logger.js';

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function makeWin(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

beforeEach(() => vi.clearAllMocks());

describe('describeError', () => {
  it('reads message and stack off an Error', () => {
    const e = new Error('bad');
    expect(describeError(e)).toEqual({ message: 'bad', stack: e.stack });
  });

  it('falls back to the error name when the message is empty', () => {
    const e = new TypeError('');
    expect(describeError(e).message).toBe('TypeError');
  });

  it('handles strings, error-like objects, plain objects and primitives', () => {
    expect(describeError('oops')).toEqual({ message: 'oops' });
    expect(describeError({ message: 'm', stack: 's' })).toEqual({ message: 'm', stack: 's' });
    expect(describeError({ code: 1 })).toEqual({ message: '{"code":1}' });
    expect(describeError(42)).toEqual({ message: '42' });
    expect(describeError(undefined)).toEqual({ message: 'undefined' });
  });
});

describe('buildReport', () => {
  it('produces a main-process report by default', () => {
    const r = buildReport('uncaughtException', new Error('x'), 'main', 123);
    expect(r).toMatchObject({ source: 'main', kind: 'uncaughtException', message: 'x', timestamp: 123 });
    expect(r.stack).toContain('x');
  });

  it('omits stack when there is none', () => {
    expect('stack' in buildReport('k', 'plain')).toBe(false);
  });
});

describe('ForwardLimiter', () => {
  it('allows up to max within the window then blocks, and recovers after', () => {
    const l = new ForwardLimiter(2, 1000);
    expect(l.allow(0)).toBe(true);
    expect(l.allow(10)).toBe(true);
    expect(l.allow(20)).toBe(false);
    expect(l.allow(1001)).toBe(true);
  });
});

describe('handleMainError', () => {
  it('logs and forwards to a live window', () => {
    const win = makeWin();
    const report = buildReport('uncaughtException', new Error('boom'));
    handleMainError(report, () => win, new ForwardLimiter());
    expect(logger.error).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.APP_ERROR, report);
  });

  it('skips forwarding to a destroyed or missing window but still logs', () => {
    const win = makeWin(true);
    handleMainError(buildReport('k', 'e'), () => win, new ForwardLimiter());
    expect(win.webContents.send).not.toHaveBeenCalled();
    handleMainError(buildReport('k', 'e'), () => null, new ForwardLimiter());
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('stops forwarding once the limiter is exhausted', () => {
    const win = makeWin();
    const limiter = new ForwardLimiter(1, 60_000);
    handleMainError(buildReport('k', 'a', 'main', 0), () => win, limiter);
    handleMainError(buildReport('k', 'b', 'main', 1), () => win, limiter);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('never throws when send throws', () => {
    const win = makeWin();
    (win.webContents.send as any).mockImplementation(() => { throw new Error('ipc closed'); });
    expect(() => handleMainError(buildReport('k', 'e'), () => win, new ForwardLimiter())).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('installProcessErrorHandlers', () => {
  it('registers both handlers and routes them through handleMainError', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const proc = { on: vi.fn((ev: string, fn: (e: unknown) => void) => { handlers[ev] = fn; }) };
    const win = makeWin();
    installProcessErrorHandlers({ getWindow: () => win, proc: proc as any });
    expect(Object.keys(handlers).sort()).toEqual(['uncaughtException', 'unhandledRejection']);
    handlers.uncaughtException(new Error('u'));
    handlers.unhandledRejection('r');
    const sent = (win.webContents.send as any).mock.calls.map((c: any[]) => c[1]);
    expect(sent.map((r: any) => [r.kind, r.message])).toEqual([
      ['uncaughtException', 'u'],
      ['unhandledRejection', 'r'],
    ]);
  });
});

describe('logRendererError', () => {
  it('logs with the session id when present', () => {
    logRendererError({ source: 'renderer', kind: 'boundary', message: 'm', sessionId: 's1', timestamp: 0 });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('session=s1'), '');
  });
});
