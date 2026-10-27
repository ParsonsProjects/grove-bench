import { describe, it, expect } from 'vitest';
import { inBackground, isBackground } from './background-work.js';

describe('background work', () => {
  it('marks what runs inside it, across awaits, and nothing outside', async () => {
    expect(isBackground()).toBe(false);
    const seen = await inBackground(async () => {
      const before = isBackground();
      await new Promise((r) => setTimeout(r, 0));
      return [before, isBackground()];
    });
    expect(seen).toEqual([true, true]);
    expect(isBackground()).toBe(false);
  });

  it('keeps work started alongside it unmarked', async () => {
    let outside: boolean | null = null;
    const other = new Promise<void>((resolve) => setTimeout(() => { outside = isBackground(); resolve(); }, 0));
    await inBackground(async () => { await other; });
    expect(outside).toBe(false);
  });
});
