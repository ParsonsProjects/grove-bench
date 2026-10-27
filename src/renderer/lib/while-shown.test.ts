import { describe, it, expect, vi } from 'vitest';
import { whileShown } from './while-shown.js';

describe('whileShown', () => {
  it('reads while shown, and keeps the last value read while hidden', () => {
    let shown = true;
    let value = 1;
    const read = vi.fn(() => value);
    const get = whileShown(() => shown, read);

    expect(get()).toBe(1);
    shown = false;
    value = 2;
    expect(get()).toBe(1);
    shown = true;
    expect(get()).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads once for a view that starts hidden, then not while it's hidden", () => {
    let value = 1;
    const read = vi.fn(() => value);
    const get = whileShown(() => false, read);
    expect(read).not.toHaveBeenCalled();

    expect(get()).toBe(1);
    value = 2;
    expect(get()).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
