import { describe, it, expect } from 'vitest';
import { GROVE_W, GROVE_H, GROVE_STAGE_GAP, groveLayout, groveRuns, grovePaths, plantStage, type GroveRun } from './context-grove.js';

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
});
