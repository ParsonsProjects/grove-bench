import { describe, it, expect } from 'vitest';
import { mapLimit } from './map-limit.js';

describe('mapLimit', () => {
  it('never runs more than the limit at once, and keeps the order of the results', async () => {
    let inFlight = 0;
    let most = 0;
    const results = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(most).toBe(2);
    expect(results).toEqual([50, 10, 40, 20, 30, 0]);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });
});
