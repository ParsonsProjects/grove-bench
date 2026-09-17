import { describe, it, expect } from 'vitest';
import { withExpandableContext, reveal, expansionFor, EXPAND_STEP } from './diff-context.js';
import type { DiffLine } from './diff-types.js';

function hunk(oldStart: number, oldCount: number, newStart: number, newCount: number): DiffLine {
  return { type: 'hunk', text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, hunk: { oldStart, oldCount, newStart, newCount } };
}
const file = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);

// Two hunks: lines 10-12 (one change) and 40-42 (one change), 3 context each side is omitted for brevity.
const lines: DiffLine[] = [
  hunk(10, 3, 10, 3),
  { type: 'context', text: 'line 10', oldLineNum: 10, newLineNum: 10 },
  { type: 'del', text: 'old 11', oldLineNum: 11 },
  { type: 'add', text: 'line 11', newLineNum: 11 },
  { type: 'context', text: 'line 12', oldLineNum: 12, newLineNum: 12 },
  hunk(40, 3, 40, 3),
  { type: 'context', text: 'line 40', oldLineNum: 40, newLineNum: 40 },
  { type: 'del', text: 'old 41', oldLineNum: 41 },
  { type: 'add', text: 'line 41', newLineNum: 41 },
  { type: 'context', text: 'line 42', oldLineNum: 42, newLineNum: 42 },
];

describe('withExpandableContext', () => {
  it('inserts expander rows before, between, and after hunks', () => {
    const out = withExpandableContext(lines, file, []);
    const gaps = out.filter(l => l.type === 'expander').map(l => [l.gap!.fromNew, l.gap!.toNew]);
    expect(gaps).toEqual([[1, 9], [13, 39], [43, 60]]);
    expect(out.filter(l => l.type !== 'expander')).toEqual(lines);
  });

  it('splices revealed lines from the file and shrinks the gap', () => {
    const out = withExpandableContext(lines, file, [[13, 20]]);
    const between = out.slice(out.findIndex(l => l.text === 'line 12') + 1, out.findIndex(l => l.type === 'hunk' && l.hunk!.newStart === 40));
    expect(between.filter(l => l.type === 'context').map(l => l.text)).toEqual(file.slice(12, 20));
    const remaining = between.find(l => l.type === 'expander')!.gap!;
    expect([remaining.fromNew, remaining.toNew]).toEqual([21, 39]);
    // Old-side numbers follow the hunk offset (identical here).
    expect(between.find(l => l.text === 'line 13')!.oldLineNum).toBe(13);
  });

  it('applies the old/new offset of the following hunk to revealed lines', () => {
    const shifted: DiffLine[] = [hunk(10, 1, 12, 1), { type: 'context', text: 'x', oldLineNum: 10, newLineNum: 12 }];
    const out = withExpandableContext(shifted, file, [[1, 11]]);
    const l = out.find(l => l.newLineNum === 11)!;
    expect(l.oldLineNum).toBe(9);
  });

  it('drops the expander when the whole gap is revealed and omits the tail past EOF', () => {
    const out = withExpandableContext(lines, file, [[1, 9], [13, 39], [43, 60]]);
    expect(out.some(l => l.type === 'expander')).toBe(false);
    expect(out.filter(l => l.type === 'context').length).toBe(60 - 2);
  });

  it('still offers expanders before the file content is loaded', () => {
    const out = withExpandableContext(lines, null, []);
    expect(out.filter(l => l.type === 'expander').length).toBe(3);
  });

  it('offers no expanders for a brand-new file shown in full', () => {
    const added: DiffLine[] = [hunk(0, 0, 1, 2), { type: 'add', text: 'a', newLineNum: 1 }, { type: 'add', text: 'b', newLineNum: 2 }];
    expect(withExpandableContext(added, null, []).some(l => l.type === 'expander')).toBe(false);
  });

  it('returns the input unchanged when there are no hunk headers', () => {
    const plain: DiffLine[] = [{ type: 'add', text: 'a', newLineNum: 1 }];
    expect(withExpandableContext(plain, file, [])).toBe(plain);
  });
});

describe('reveal / expansionFor', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(reveal([[1, 5]], 6, 8)).toEqual([[1, 8]]);
    expect(reveal([[1, 5]], 3, 4)).toEqual([[1, 5]]);
    expect(reveal([[10, 12]], 1, 2)).toEqual([[1, 2], [10, 12]]);
  });

  it('expands by one step from the right end of the gap', () => {
    const gap = { id: 'g', fromNew: 1, toNew: 50, oldOffset: 0 };
    expect(expansionFor(gap, 'up')).toEqual([50 - EXPAND_STEP + 1, 50]);
    expect(expansionFor(gap, 'down')).toEqual([1, EXPAND_STEP]);
    expect(expansionFor(gap, 'all')).toEqual([1, 50]);
    expect(expansionFor({ ...gap, toNew: 5 }, 'up')).toEqual([1, 5]);
  });
});
