import { describe, it, expect } from 'vitest';
import { STEP_ICON_ART, stepIconFor, stepIconRuns } from './step-icons.js';

describe('step icons', () => {
  it('draws each on a 12 by 12 grid of pixels', () => {
    for (const [kind, rows] of Object.entries(STEP_ICON_ART)) {
      expect(rows, kind).toHaveLength(12);
      for (const row of rows) expect(row, kind).toMatch(/^[.#]{12}$/);
    }
  });

  it('draws a row of pixels as one run per stretch', () => {
    const runs = stepIconRuns('run');
    // The prompt's underline: one run six pixels wide.
    expect(runs).toContainEqual({ x: 5, y: 9, w: 6 });
    // Every filled pixel is in exactly one run.
    const filled = STEP_ICON_ART.run.join('').split('').filter((c) => c === '#').length;
    expect(runs.reduce((n, r) => n + r.w, 0)).toBe(filled);
  });

  it('picks the icon for a tool call by what it does', () => {
    expect(stepIconFor({ kind: 'read' })).toBe('read');
    expect(stepIconFor({ kind: 'shell' })).toBe('run');
    expect(stepIconFor({ kind: 'fetch' })).toBe('web');
    expect(stepIconFor({ kind: 'web_search' })).toBe('web');
    expect(stepIconFor({ kind: 'other' })).toBe('tool');
  });
});
