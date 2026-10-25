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

  it('lines up a plain insertion or deletion of more lines than the cap on changes', () => {
    const block = file.slice(0, 600).join('\n');
    const inserted = quickEditDiff(edit('export {}\n', `export {}\n${block}\n`), 'notes.txt').diff;
    expect(inserted?.linedUp).toBe(true);
    expect(inserted?.lines.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['export {}']);
    expect(inserted?.lines.filter((l) => l.type === 'add')).toHaveLength(600);
    expect(quickEditDiff(edit(`${block}\nend`, 'end'), 'notes.txt').diff?.linedUp).toBe(true);
  });

  it('gives up on a large edit at its first replacement past the cap, rather than half a diff', () => {
    vi.mocked(createPatch).mockReturnValue(undefined as never);
    vi.mocked(createPatch).mockClear();
    const half = file.slice(0, 600).join('\n');
    const view: ToolView = { kind: 'edit', path: 'f', edits: [{ oldText: half, newText: `${half}!` }, { oldText: half, newText: `!${half}` }] };

    expect(quickEditDiff(view, 'f')).toEqual({ diff: null, large: true });
    expect(createPatch).toHaveBeenCalledOnce();
  });

  it('shows an edit under the limits at once as the old text, then the new, after one capped try', () => {
    vi.mocked(createPatch).mockReturnValue(undefined as never);
    vi.mocked(createPatch).mockClear();
    // Past the size a replacement is always diffed at.
    const many = file.slice(0, 60).join('\n');
    const { diff, large } = quickEditDiff(edit(`${many}\none\ntwo\n`, `${many}\nuno\n`), 'notes.txt');
    expect(large).toBe(false);
    expect(diff?.linedUp).toBe(false);
    // Only the quick try gave up, so a full one may line it up.
    expect(diff?.quick).toBe(true);
    expect(diff?.lines[0]).toEqual({ type: 'hunk', text: '@@ -1,62 +1,61 @@' });
    expect(diff?.lines.slice(-3).map((l) => [l.type, l.text])).toEqual([['add', 'line 58'], ['add', 'line 59'], ['add', 'uno']]);
    expect(createPatch).toHaveBeenCalledOnce();
    const opts = vi.mocked(createPatch).mock.calls[0][5] as { timeout?: number; maxEditLength?: number };
    expect(opts.timeout).toBeLessThanOrEqual(50);
    expect(opts.maxEditLength).toBeUndefined();
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
    const { lines, linedUp, quick } = fullEditDiff(edit('one\ntwo\n', 'uno\n'), 'notes.txt', null);
    expect(linedUp).toBe(false);
    expect(quick).toBeUndefined();
    expect(lines).toEqual([
      { type: 'hunk', text: '@@ -1,2 +1,1 @@' },
      { type: 'del', text: 'one', lineNum: 1, oldLineNum: 1, unpaired: true },
      { type: 'del', text: 'two', lineNum: 2, oldLineNum: 2, unpaired: true },
      { type: 'add', text: 'uno', lineNum: 1, newLineNum: 1, unpaired: true },
    ]);
  });

  it('falls back one replacement at a time: the others keep their diffs', () => {
    // The second replacement runs out of time; the first and third don't.
    vi.mocked(createPatch)
      .mockImplementationOnce(realCreatePatch)
      .mockImplementationOnce((() => undefined) as never)
      .mockImplementationOnce(realCreatePatch);
    const view: ToolView = { kind: 'edit', path: 'f', edits: [
      { oldText: 'let a = 1;\n', newText: 'let a = 2;\n' },
      { oldText: 'x\ny\n', newText: 'y\nx\n' },
      { oldText: 'let c = 1;\n', newText: 'let c = 3;\n' },
    ] };

    const diff = fullEditDiff(view, 'f', null);

    expect(diff).toMatchObject({ linedUp: false, partly: true });
    expect(diff.lines.filter((l) => l.type !== 'hunk').map((l) => [l.type, l.text, !!l.unpaired])).toEqual([
      ['del', 'let a = 1;', false], ['add', 'let a = 2;', false],
      ['del', 'x', true], ['del', 'y', true], ['add', 'y', true], ['add', 'x', true],
      ['del', 'let c = 1;', false], ['add', 'let c = 3;', false],
    ]);
  });

  /** A replacement past the size one is always diffed at. */
  const big = (word: string) => file.slice(0, 60).map((l) => `${word} ${l}`).join('\n');
  /** Big replacements run out of time; small ones are never given a limit. */
  const bigOnesGiveUp = () => vi.mocked(createPatch).mockImplementation(((...args: Parameters<typeof realCreatePatch>) =>
    (args[5] as { timeout?: number } | undefined)?.timeout !== undefined ? undefined : realCreatePatch(...args)) as typeof createPatch);

  it("doesn't try a big replacement once the time is up", () => {
    const now = vi.spyOn(performance, 'now');
    // The deadline is set at 0; the second replacement starts at 2 s.
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(2000);
    const view: ToolView = { kind: 'edit', path: 'f', edits: [{ oldText: big('a'), newText: big('b') }, { oldText: big('c'), newText: big('d') }] };
    vi.mocked(createPatch).mockClear();
    const diff = fullEditDiff(view, 'f', null);
    expect(diff).toMatchObject({ linedUp: false, partly: true });
    expect(createPatch).toHaveBeenCalledOnce();
  });

  it('diffs a small replacement whatever the time left, after a big one ran out', () => {
    bigOnesGiveUp();
    const view: ToolView = { kind: 'edit', path: 'f', edits: [{ oldText: big('a'), newText: big('b') }, { oldText: 'let a = 1;\n', newText: 'let a = 2;\n' }] };

    const diff = fullEditDiff(view, 'f', null);

    expect(diff).toMatchObject({ linedUp: false, partly: true });
    expect(diff.lines.filter((l) => !l.unpaired && l.type !== 'hunk').map((l) => [l.type, l.text])).toEqual([['del', 'let a = 1;'], ['add', 'let a = 2;']]);
  });

  it('always diffs a replacement of up to 50 lines a side, and gives a longer one a limit', () => {
    bigOnesGiveUp();
    const side = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i}`).join('\n') + '\n';

    expect(fullEditDiff({ kind: 'edit', path: 'f', edits: [{ oldText: side(50, 'a'), newText: side(50, 'b') }] }, 'f', null).linedUp).toBe(true);
    expect(fullEditDiff({ kind: 'edit', path: 'f', edits: [{ oldText: side(51, 'a'), newText: side(50, 'b') }] }, 'f', null).linedUp).toBe(false);
    // 51 lines with no newline at the end are 50 line breaks.
    expect(fullEditDiff({ kind: 'edit', path: 'f', edits: [{ oldText: side(51, 'a').slice(0, -1), newText: side(50, 'b') }] }, 'f', null).linedUp).toBe(false);
    // Or of up to 5,000 characters.
    expect(fullEditDiff({ kind: 'edit', path: 'f', edits: [{ oldText: 'x'.repeat(5001), newText: 'y' }] }, 'f', null).linedUp).toBe(false);
  });

  it("doesn't count a replacement that changes nothing as compared", () => {
    bigOnesGiveUp();
    const view: ToolView = { kind: 'edit', path: 'f', edits: [{ oldText: 'same', newText: 'same' }, { oldText: big('a'), newText: big('b') }] };

    const diff = fullEditDiff(view, 'f', null);

    expect(diff.linedUp).toBe(false);
    expect(diff.partly).toBeUndefined();
  });

  it('works out a diff with more lines than a function call can take', () => {
    // Spreading this many into push() overflows the stack.
    const removed = Array.from({ length: 140_000 }, (_, i) => `row ${i}`).join('\n');
    const { lines, linedUp } = fullEditDiff(edit(removed, ''), 'notes.txt', null);
    expect(linedUp).toBe(true);
    expect(lines.filter((l) => l.type === 'del')).toHaveLength(140_000);
  });
});
