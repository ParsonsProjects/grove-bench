import { describe, it, expect, vi } from 'vitest';
import { reportFromError, shortMessage, ErrorDeduper, installRendererErrorHandlers } from './error-handling.js';

describe('reportFromError', () => {
  it('captures Error message and stack with the session', () => {
    const e = new Error('kaboom');
    const r = reportFromError('boundary', e, 's1', 5);
    expect(r).toMatchObject({ source: 'renderer', kind: 'boundary', message: 'kaboom', sessionId: 's1', timestamp: 5 });
    expect(r.stack).toBe(e.stack);
  });

  it('handles non-Error payloads', () => {
    expect(reportFromError('error', 'text').message).toBe('text');
    expect(reportFromError('error', { message: 'obj' }).message).toBe('obj');
    expect(reportFromError('error', null).message).toBe('null');
    expect('sessionId' in reportFromError('error', 'x')).toBe(false);
  });
});

describe('shortMessage', () => {
  it('prefixes by source and collapses whitespace', () => {
    expect(shortMessage(reportFromError('error', 'a\n  b'))).toBe('Unexpected error: a b');
    expect(shortMessage({ source: 'main', kind: 'k', message: 'm', timestamp: 0 })).toBe('Background error: m');
  });

  it('truncates long messages', () => {
    const s = shortMessage(reportFromError('error', 'x'.repeat(500)));
    expect(s.length).toBe(200);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('ErrorDeduper', () => {
  it('drops repeats inside the window and accepts them after', () => {
    const d = new ErrorDeduper(1000);
    expect(d.accept(reportFromError('error', 'same', undefined, 0))).toBe(true);
    expect(d.accept(reportFromError('error', 'same', undefined, 500))).toBe(false);
    expect(d.accept(reportFromError('error', 'other', undefined, 500))).toBe(true);
    expect(d.accept(reportFromError('error', 'same', undefined, 1000))).toBe(true);
  });
});

describe('installRendererErrorHandlers', () => {
  it('reports window error and rejection events, and ignores ResizeObserver noise', () => {
    const onReport = vi.fn();
    const uninstall = installRendererErrorHandlers(onReport);

    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    expect(onReport).not.toHaveBeenCalled();

    window.dispatchEvent(new ErrorEvent('error', { message: 'plain', error: new Error('thrown') }));
    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'error', message: 'thrown' }));

    // jsdom has no PromiseRejectionEvent constructor; dispatch a generic event with a reason.
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('rejected');
    window.dispatchEvent(rejection);
    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'unhandledrejection', message: 'rejected' }));

    const removed = vi.spyOn(window, 'removeEventListener');
    uninstall();
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'unhandledrejection']);
    removed.mockRestore();
  });
});
