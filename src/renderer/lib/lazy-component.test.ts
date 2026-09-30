import { describe, it, expect, vi } from 'vitest';
import { lazyComponent } from './lazy-component.js';

describe('lazyComponent', () => {
  it('loads nothing until first asked, then loads once and reuses it', async () => {
    const Comp = {};
    const load = vi.fn(async () => ({ default: Comp }));
    const get = lazyComponent(load);
    expect(load).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([get(), get()]);

    expect(a).toBe(Comp);
    expect(b).toBe(Comp);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
