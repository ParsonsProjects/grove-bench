import { describe, it, expect, vi, afterEach } from 'vitest';
import { within } from './preview.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('within', () => {
  it('resolves true when the promise settles in time and clears its timer', async () => {
    vi.useFakeTimers();
    await expect(within(Promise.resolve('ok'), 1000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('resolves true for a real promise', async () => {
    await expect(within(Promise.resolve('ok'), 1000)).resolves.toBe(true);
  });

  it('rethrows a rejection that happens in time', async () => {
    await expect(within(Promise.reject(new Error('ERR_CONNECTION_REFUSED')), 1000)).rejects.toThrow('ERR_CONNECTION_REFUSED');
  });

  it('resolves false on timeout, and a later rejection is not left unhandled', async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const slow = new Promise((_resolve, reject) => { fail = reject; });
    const result = within(slow, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe(false);
    // Vitest fails the run on an unhandled rejection. Promise.race keeps a
    // handler on the slow promise, so the late failure is handled.
    fail(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
