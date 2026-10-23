import { describe, it, expect } from 'vitest';
import {
  GROVE_W, GROVE_H, GROVE_STAGE_GAP, GROVE_GROW_MS, GROVE_SEASONS, GROVE_TURN_SPAN, GroveGrowth, groveLayout, groveRuns, grovePaths, groveSweepMs,
  plantSeason, plantStage,
  type GrovePlant, type GroveRun,
} from './context-grove.js';
import { usageTone } from './usage-tone.js';

const pixels = (runs: GroveRun[]) => runs.reduce((n, r) => n + r.w, 0);

/** The start of 'conv-1's grove, and its size, before any plant stood from the start. */
const BEFORE = [
  { x: 2, kind: 'bush', at: 18.20317461900413, far: false, bloom: null },
  { x: 8, kind: 'bush', at: 42.16015343554318, far: false, bloom: null },
  { x: 11, kind: 'grass', at: 88.31538374070078, far: false, bloom: null },
];
const BEFORE_COUNT = 417;

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

  it('stands a few small plants from the start, sprouts the rest above 0%, and has all fully grown by 100%', () => {
    const plants = groveLayout('conv-1');
    for (const p of plants) {
      // Standing plants are at their smallest stage; the rest have not sprouted.
      expect(plantStage(p, 0)).toBe(p.at <= 0 ? 0 : -1);
      expect(p.at).toBeGreaterThan(-GROVE_STAGE_GAP);
      expect(plantStage(p, 100)).toBe(plantStage(p, Infinity));
    }
    const standing = plants.filter((p) => p.at <= 0).length / plants.length;
    expect(standing).toBeGreaterThan(0.1);
    expect(standing).toBeLessThan(0.3);
  });

  it('keeps the places, kinds and sprouting of the plants it had before plants stood from the start', () => {
    // The first plants of 'conv-1' as they were laid out before; only the
    // plants now standing from the start sprout earlier.
    const plants = groveLayout('conv-1');
    expect(plants).toHaveLength(BEFORE_COUNT);
    const first = plants.slice(0, 3);
    expect(first.map(({ x, kind, far, bloom }) => ({ x, kind, far, bloom }))).toEqual(BEFORE.map(({ x, kind, far, bloom }) => ({ x, kind, far, bloom })));
    first.forEach((p, i) => { if (p.at > 0) expect(p.at).toBeCloseTo(BEFORE[i].at, 10); });
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

  it('is a little grove of small plants with no context used', () => {
    const runs = groveRuns(plants, 0);
    expect(runs.length).toBeGreaterThan(0);
    // Saplings and tufts are 3 rows high at most.
    expect(Math.min(...runs.map((r) => r.y))).toBeGreaterThanOrEqual(GROVE_H - 3);
  });

  it('shows more of the grove as the context fills', () => {
    const counts = [0, 5, 25, 50, 75, 100].map((pct) => pixels(groveRuns(plants, pct)));
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

  it('has turned every plant once the bar has', () => {
    const fills = (pct: number) => new Set(groveRuns(plants, pct).map((r) => r.fill));
    // Just past each step in usage-tone.ts, the only leaves are that season's.
    for (const [pct, season] of [[10, 'ok'], [41, 'filling'], [71, 'low'], [86, 'full']] as const) {
      const shown = fills(pct);
      for (const [other, leaves] of Object.entries(GROVE_SEASONS)) {
        for (const leaf of leaves) expect(shown.has(leaf), `${leaf} at ${pct}%`).toBe(other === season);
      }
    }
  });
});

describe('context grove seasons', () => {
  const plants = groveLayout('conv-1');
  const SEASONS = ['ok', 'filling', 'low', 'full'];
  const turned = (pct: number) => plants.filter((p) => plantSeason(p, pct) !== usageTone(pct)).length;

  it('is never calmer than the bar, and at most one season ahead', () => {
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const bar = SEASONS.indexOf(usageTone(pct));
      for (const p of plants) {
        const ahead = SEASONS.indexOf(plantSeason(p, pct)) - bar;
        expect(ahead, `${pct}%`).toBeGreaterThanOrEqual(0);
        expect(ahead, `${pct}%`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('turns a plant at a time in the run-up to each step', () => {
    for (const step of [40, 70, 85]) {
      expect(turned(step - GROVE_TURN_SPAN)).toBe(0);
      const counts = [0.25, 0.5, 0.75].map((f) => turned(step - GROVE_TURN_SPAN * (1 - f)));
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts.at(-1)).toBeLessThan(plants.length);
    }
  });
});

describe('context grove growing', () => {
  const tree: GrovePlant = { x: 10, kind: 'tree', at: 10, far: false, bloom: null, turn: 0 };
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
