import { describe, it, expect } from 'vitest';
import { WALK_BACK, WALK_FRONT, WALK_GROUND_Y, WALK_VIEW_W, WALK_FRAME_SECONDS, WAKE_AWAKE_AT_MS, WAKE_WALK_AT_MS, WAKE_SCENE_MS, BENCH_PATH_OFFSET, WAKE_PATH_HEAD_START_SECONDS, wakePhase, ARRIVE_SIT_AT_MS, ARRIVE_TYPE_AT_MS, ARRIVE_PATH_FROM, arrivePhase } from './grove-walk.js';
import { SCENERY_PALETTE, BENCH } from './agent-sprite.js';

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

describe('wake-up scene', () => {
  it('goes asleep, awake, then walking, and ends after the walk starts', () => {
    expect(wakePhase(0)).toBe('asleep');
    expect(wakePhase(WAKE_AWAKE_AT_MS - 1)).toBe('asleep');
    expect(wakePhase(WAKE_AWAKE_AT_MS)).toBe('awake');
    expect(wakePhase(WAKE_WALK_AT_MS - 1)).toBe('awake');
    expect(wakePhase(WAKE_WALK_AT_MS)).toBe('walking');
    expect(WAKE_SCENE_MS).toBeGreaterThan(WAKE_WALK_AT_MS);
  });

  it("starts the path at its bench, centred in the view, in whole pixels", () => {
    expect(Number.isInteger(BENCH_PATH_OFFSET)).toBe(true);
    // The bench's seat and back are the path's only full-width wooden runs
    // (tree trunks share the colours but are 2 wide).
    const bench = WALK_FRONT.rects.filter((r) => r.fill === SCENERY_PALETTE.w && r.w === BENCH[0].length);
    expect(bench.length).toBeGreaterThan(0);
    const left = Math.min(...bench.map((r) => r.x)) - BENCH_PATH_OFFSET;
    const right = Math.max(...bench.map((r) => r.x + r.w)) - BENCH_PATH_OFFSET;
    expect((left + right) / 2).toBe(WALK_VIEW_W / 2);
    expect(WAKE_PATH_HEAD_START_SECONDS).toBeCloseTo((BENCH_PATH_OFFSET / WALK_FRONT.width) * WALK_FRONT.seconds);
  });
});

describe('arrival scene', () => {
  it('walks, sits down, then is ready to type', () => {
    expect(arrivePhase(0)).toBe('walking');
    expect(arrivePhase(ARRIVE_SIT_AT_MS - 1)).toBe('walking');
    expect(arrivePhase(ARRIVE_SIT_AT_MS)).toBe('seated');
    expect(arrivePhase(ARRIVE_TYPE_AT_MS - 1)).toBe('seated');
    expect(arrivePhase(ARRIVE_TYPE_AT_MS)).toBe('typing');
    expect(arrivePhase(Infinity)).toBe('typing');
  });

  it('walks the path, in whole pixels, to where the bench is centred', () => {
    const speed = WALK_FRONT.width / WALK_FRONT.seconds;
    expect(Number.isInteger(ARRIVE_PATH_FROM)).toBe(true);
    expect(ARRIVE_PATH_FROM).toBeGreaterThanOrEqual(0);
    expect(BENCH_PATH_OFFSET - ARRIVE_PATH_FROM).toBeCloseTo((ARRIVE_SIT_AT_MS / 1000) * speed);
  });

  it('shows the bench ahead, in the view, as the walk starts', () => {
    const bench = WALK_FRONT.rects.filter((r) => r.fill === SCENERY_PALETTE.w && r.w === BENCH[0].length);
    const left = Math.min(...bench.map((r) => r.x)) - ARRIVE_PATH_FROM;
    const right = Math.max(...bench.map((r) => r.x + r.w)) - ARRIVE_PATH_FROM;
    expect(left).toBeGreaterThan(WALK_VIEW_W / 2);
    expect(right).toBeLessThanOrEqual(WALK_VIEW_W);
  });
});
