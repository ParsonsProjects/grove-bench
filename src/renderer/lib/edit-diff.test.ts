import { describe, it, expect, vi, afterEach } from 'vitest';

// Spied on, to make a diff give up as if out of time.
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>();
  return { ...actual, createPatch: vi.fn(actual.createPatch) };
});

import { createPatch } from 'diff';
import { quickEditDiff, fullEditDiff } from './edit-diff.js';
import type { ToolView } from '../../shared/tool-view.js';

const { createPatch: realCreatePatch } = await vi.importActual<typeof import('diff')>('diff');
const edit = (oldText: string, newText: string): ToolView => ({ kind: 'edit', path: 'notes.txt', edits: [{ oldText, newText }] });
// 2,002 lines across both sides: over the large-diff limit by lines.
const file = Array.from({ length: 1001 }, (_, i) => `line ${i}`);

afterEach(() => {
  vi.mocked(createPatch).mockImplementation(realCreatePatch);
  vi.restoreAllMocks();
});

describe('quickEditDiff', () => {
  it('diffs a small edit as it is', () => {
    const { diff, large } = quickEditDiff(edit('a', 'b'), 'notes.txt');
    expect(large).toBe(false);
    expect(diff?.linedUp).toBe(true);
    expect(diff?.lines.filter((l) => l.type !== 'hunk').map((l) => [l.type, l.text])).toEqual([['del', 'a'], ['add', 'b']]);
  });

  it('shows a small change to a large file at once', () => {
    const after = [...file];
    after[500] = 'changed';
    const { diff, large } = quickEditDiff(edit(file.join('\n'), after.join('\n')), 'notes.txt');
    expect(large).toBe(false);
    expect(diff?.lines.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['changed']);
  });

  it('shows a rewrite under the limits at once as the old text, then the new, after one capped try', () => {
    // 1,200 lines across both sides, under the limit; reversed, about 1,200 changes, past the cap.
    const lines600 = file.slice(0, 600);
    vi.mocked(createPatch).mockClear();
    const { diff, large } = quickEditDiff(edit(lines600.join('\n'), [...lines600].reverse().join('\n')), 'notes.txt');
    expect(large).toBe(false);
    expect(diff?.linedUp).toBe(false);
    expect(diff?.lines.filter((l) => l.type === 'del')).toHaveLength(600);
    expect(diff?.lines.filter((l) => l.type === 'add')).toHaveLength(600);
    expect(createPatch).toHaveBeenCalledOnce();
    expect(vi.mocked(createPatch).mock.calls[0][5]).toMatchObject({ maxEditLength: 500 });
  });

  it('holds back a heavily changed large file, without working it out', () => {
    expect(quickEditDiff(edit(file.join('\n'), [...file].reverse().join('\n')), 'notes.txt')).toEqual({ diff: null, large: true });
  });

  it('holds back a large write without splitting it', () => {
    expect(quickEditDiff({ kind: 'edit', path: 'big.txt', write: file.join('\n') + '\n' + file.join('\n') }, 'big.txt')).toEqual({ diff: null, large: true });
  });

  it('draws a small write as its lines', () => {
    expect(quickEditDiff({ kind: 'edit', write: 'a\nb' }, 'f')).toEqual({ diff: { lines: [{ type: 'add', text: 'a', lineNum: 1 }, { type: 'add', text: 'b', lineNum: 2 }], linedUp: true }, large: false });
  });
});

describe('fullEditDiff', () => {
  it('uses what quickEditDiff already worked out', () => {
    const known = { lines: [{ type: 'add' as const, text: 'x', lineNum: 1 }], linedUp: false };
    expect(fullEditDiff(edit('a', 'b'), 'notes.txt', known)).toBe(known);
  });

  it('draws a write as its lines', () => {
    expect(fullEditDiff({ kind: 'edit', write: 'a\nb' }, 'f', null).lines.map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('shows the old text, then the new, when the diff runs out of time', () => {
    vi.mocked(createPatch).mockReturnValue(undefined as never);
    const { lines, linedUp } = fullEditDiff(edit('one\ntwo\n', 'uno\n'), 'notes.txt', null);
    expect(linedUp).toBe(false);
    expect(lines).toEqual([
      { type: 'hunk', text: '@@ -1,2 +1,1 @@' },
      { type: 'del', text: 'one', lineNum: 1, oldLineNum: 1 },
      { type: 'del', text: 'two', lineNum: 2, oldLineNum: 2 },
      { type: 'add', text: 'uno', lineNum: 1, newLineNum: 1 },
    ]);
  });

  it('stops before the next replacement once the time is up', () => {
    const now = vi.spyOn(performance, 'now');
    // The deadline is set at 0; the second replacement starts at 2 s.
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(2000);
    const view: ToolView = { kind: 'edit', path: 'f', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] };
    vi.mocked(createPatch).mockClear();
    const { linedUp } = fullEditDiff(view, 'f', null);
    expect(linedUp).toBe(false);
    expect(createPatch).toHaveBeenCalledOnce();
  });

  it('works out a diff with more lines than a function call can take', () => {
    // Spreading this many into push() overflows the stack.
    const removed = Array.from({ length: 140_000 }, (_, i) => `row ${i}`).join('\n');
    const { lines, linedUp } = fullEditDiff(edit(removed, ''), 'notes.txt', null);
    expect(linedUp).toBe(true);
    expect(lines.filter((l) => l.type === 'del')).toHaveLength(140_000);
  });
});
