import { describe, it, expect } from 'vitest';
import {
  GROVE_W, GROVE_H, GROVE_STAGE_GAP, GROVE_GROW_MS, GROVE_SEASONS, GroveGrowth, groveLayout, groveRuns, grovePaths, groveSweepMs, plantStage,
  type GrovePlant, type GroveRun,
} from './context-grove.js';

const pixels = (runs: GroveRun[]) => runs.reduce((n, r) => n + r.w, 0);

describe('context grove layout', () => {
  it('gives a conversation the same grove every time', () => {
    expect(groveLayout('conv-1')).toEqual(groveLayout('conv-1'));
  });

  it('gives different conversations different groves', () => {
    expect(groveLayout('conv-1')).not.toEqual(groveLayout('conv-2'));
  });

  it('spreads plants of every kind along the whole strip', () => {
    const plants = groveLayout('conv-1');
    expect(new Set(plants.map((p) => p.kind))).toEqual(new Set(['tree', 'small-tree', 'bush', 'grass']));
    expect(plants.some((p) => p.far)).toBe(true);
    expect(plants.some((p) => p.bloom)).toBe(true);
    expect(plants[0].x).toBeLessThan(10);
    expect(plants.at(-1)!.x).toBeGreaterThan(GROVE_W - 30);
  });

  it('sprouts every plant above 0% and has it fully grown by 100%', () => {
    for (const p of groveLayout('conv-1')) {
      expect(p.at).toBeGreaterThan(0);
      expect(plantStage(p, 0)).toBe(-1);
      expect(plantStage(p, 100)).toBe(plantStage(p, Infinity));
    }
  });

  it('grows a plant a stage at a time', () => {
    const tree = groveLayout('conv-1').find((p) => p.kind === 'tree')!;
    expect(plantStage(tree, tree.at - 0.1)).toBe(-1);
    expect(plantStage(tree, tree.at)).toBe(0);
    expect(plantStage(tree, tree.at + GROVE_STAGE_GAP)).toBe(1);
    expect(plantStage(tree, tree.at + GROVE_STAGE_GAP * 2)).toBe(2);
  });
});

describe('context grove drawing', () => {
  const plants = groveLayout('conv-1');

  it('is bare ground with no context used', () => {
    expect(groveRuns(plants, 0)).toEqual([]);
  });

  it('shows more of the grove as the context fills', () => {
    const counts = [5, 25, 50, 75, 100].map((pct) => pixels(groveRuns(plants, pct)));
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('stands every plant on the ground, inside the strip', () => {
    const runs = groveRuns(plants, 100);
    expect(Math.max(...runs.map((r) => r.y))).toBe(GROVE_H - 1);
    for (const r of runs) {
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(GROVE_W);
    }
  });

  it('never draws two colours on one pixel', () => {
    const seen = new Set<string>();
    for (const r of groveRuns(plants, 100)) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const at = `${x},${r.y}`;
        expect(seen.has(at), at).toBe(false);
        seen.add(at);
      }
    }
  });

  it('draws one path per colour and depth', () => {
    const runs = groveRuns(plants, 100);
    const paths = grovePaths(runs);
    expect(paths.length).toBe(new Set(runs.map((r) => `${r.far} ${r.fill}`)).size);
    expect(paths.length).toBeLessThan(20);
  });

  it('turns its leaves at the same steps as the context meter', () => {
    const fills = (pct: number) => new Set(groveRuns(plants, pct).map((r) => r.fill));
    // One percent either side of each step in usage-tone.ts.
    for (const [pct, season] of [[40, 'ok'], [41, 'filling'], [70, 'filling'], [71, 'low'], [85, 'low'], [86, 'full']] as const) {
      const shown = fills(pct);
      for (const [other, leaves] of Object.entries(GROVE_SEASONS)) {
        for (const leaf of leaves) expect(shown.has(leaf), `${leaf} at ${pct}%`).toBe(other === season);
      }
    }
  });
});

describe('context grove growing', () => {
  const tree: GrovePlant = { x: 10, kind: 'tree', at: 10, far: false, bloom: null };
  const top = (runs: GroveRun[]) => Math.min(...runs.map((r) => r.y));

  it('rises out of the ground, top first', () => {
    // A sapling is 3 rows: its tip, then its leaves, then its trunk.
    const rising = (risen: number) => groveRuns([tree], tree.at, new Map([[0, risen]]));
    expect(rising(0)).toEqual([{ x: 10, y: GROVE_H - 1, w: 1, fill: '#5ab868', far: false }]);
    expect(top(rising(0.5))).toBe(GROVE_H - 2);
    expect(rising(0.99)).toEqual(groveRuns([tree], tree.at));
    for (const risen of [0, 0.3, 0.6, 0.99]) {
      expect(Math.max(...rising(risen).map((r) => r.y))).toBe(GROVE_H - 1);
    }
  });

  it('keeps the stage before standing while the next one rises', () => {
    const young = tree.at + GROVE_STAGE_GAP;
    const sapling = groveRuns([tree], tree.at);
    const rising = groveRuns([tree], young, new Map([[0, 0]]));
    expect(top(rising)).toBe(top(sapling));
    expect(pixels(rising)).toBeGreaterThanOrEqual(pixels(sapling));
  });
});

describe('GroveGrowth', () => {
  const plants = groveLayout('conv-1');

  it('starts settled', () => {
    expect(new GroveGrowth(plants, 40).frame(0)).toEqual({ percent: 40, growth: new Map(), done: true });
  });

  it('sweeps to the new percent, so plants sprout one after another', () => {
    const grove = new GroveGrowth(plants, 40);
    grove.retarget(60, 1000);
    const end = 1000 + groveSweepMs(20);
    expect(grove.frame(1000).percent).toBe(40);
    const mid = grove.frame((1000 + end) / 2);
    expect(mid.percent).toBeCloseTo(50);
    expect(mid.growth.size).toBeGreaterThan(0);
    expect(mid.done).toBe(false);
    expect(grove.frame(end).percent).toBe(60);
  });

  it('rises each new plant over GROVE_GROW_MS, then is done', () => {
    const grove = new GroveGrowth(plants, 40);
    grove.retarget(60, 0);
    const end = groveSweepMs(20);
    const last = grove.frame(end);
    expect(last.done).toBe(false);
    for (const risen of last.growth.values()) {
      expect(risen).toBeGreaterThanOrEqual(0);
      expect(risen).toBeLessThan(1);
    }
    expect(grove.frame(end + GROVE_GROW_MS)).toEqual({ percent: 60, growth: new Map(), done: true });
  });

  it('carries on from where it is when the target changes mid-sweep', () => {
    const grove = new GroveGrowth(plants, 40);
    grove.retarget(60, 0);
    const mid = groveSweepMs(20) / 2;
    const before = grove.frame(mid).percent;
    grove.retarget(30, mid);
    expect(grove.frame(mid).percent).toBeCloseTo(before);
    expect(grove.frame(mid + groveSweepMs(before - 30) + GROVE_GROW_MS).percent).toBe(30);
  });

  it('lets plants go without growing anything', () => {
    const grove = new GroveGrowth(plants, 80);
    grove.retarget(10, 0);
    expect(grove.frame(groveSweepMs(70) / 2).growth.size).toBe(0);
    expect(grove.frame(groveSweepMs(70))).toEqual({ percent: 10, growth: new Map(), done: true });
  });

  it('jumps straight there when settled', () => {
    const grove = new GroveGrowth(plants, 40);
    grove.retarget(60, 0);
    grove.frame(100);
    grove.settle(70);
    expect(grove.frame(200)).toEqual({ percent: 70, growth: new Map(), done: true });
  });
});
