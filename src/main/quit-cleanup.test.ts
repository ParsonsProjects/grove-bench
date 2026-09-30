import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from './logger.js';
import { runQuitCleanup } from './quit-cleanup.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runQuitCleanup', () => {
  it('resolves when the cleanup finishes', async () => {
    const cleanup = vi.fn(async () => {});
    await runQuitCleanup(cleanup, 1000);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('Cleanup complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a cleanup that never settles', async () => {
    let settled = false;
    const done = runQuitCleanup(() => new Promise(() => {}), 1000).then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(settled).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('exiting anyway'));
  });

  it('logs a failing cleanup instead of rejecting', async () => {
    await expect(runQuitCleanup(async () => { throw new Error('boom'); }, 1000)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Cleanup error during quit:', expect.any(Error));
    expect(vi.getTimerCount()).toBe(0);
  });
});
