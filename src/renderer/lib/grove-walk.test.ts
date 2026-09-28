import { describe, it, expect } from 'vitest';
import { WALK_BACK, WALK_FRONT, WALK_GROUND_Y, WALK_VIEW_W, WALK_FRAME_SECONDS } from './grove-walk.js';

describe('grove walk layers', () => {
  for (const [name, layer] of Object.entries({ back: WALK_BACK, front: WALK_FRONT })) {
    it(`${name}: keeps every prop inside its strip, so the loop has no seam`, () => {
      expect(layer.rects.length).toBeGreaterThan(0);
      for (const r of layer.rects) {
        expect(r.x, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, JSON.stringify(r)).toBeLessThanOrEqual(layer.width);
      }
    });

    it(`${name}: stands every prop on the ground`, () => {
      const bottom = Math.max(...layer.rects.map((r) => r.y + r.h));
      expect(bottom).toBe(WALK_GROUND_Y);
      for (const r of layer.rects) expect(r.y).toBeGreaterThanOrEqual(0);
    });

    it(`${name}: is wider than the view, so the second copy covers the gap`, () => {
      expect(layer.width).toBeGreaterThanOrEqual(WALK_VIEW_W);
    });
  }

  it('moves the distant trees slower than the path', () => {
    const speed = (l: typeof WALK_BACK) => l.width / l.seconds;
    expect(speed(WALK_BACK)).toBeLessThan(speed(WALK_FRONT));
  });

  it('takes a step for every few pixels of path', () => {
    const pathPerStep = (WALK_FRONT.width / WALK_FRONT.seconds) * WALK_FRAME_SECONDS;
    expect(pathPerStep).toBeCloseTo(3);
  });
});
