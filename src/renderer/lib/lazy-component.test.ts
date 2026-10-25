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

  it('forgets a load that failed, so the next ask tries again', async () => {
    const Comp = {};
    const load = vi.fn<() => Promise<{ default: object }>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: Comp });
    const get = lazyComponent(load);

    await expect(get()).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(await get()).toBe(Comp);
    expect(await get()).toBe(Comp);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
