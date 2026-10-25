import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window so highlight.js spans survive it.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});

import DiffView from './DiffView.svelte';
import { parseDiffLines } from '../lib/diff-parse.js';
import type { DiffLine, ReviewComment } from '../lib/diff-types.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lines = parseDiffLines(['@@ -5,2 +5,2 @@', ' keep();', '-oldCall();', '+newCall();', ''].join('\n'));

function comment(side: 'old' | 'new', line: number, body: string): ReviewComment {
  return { id: body, filePath: 'f.ts', side, startLine: line, endLine: line, snippet: '', body, createdAt: 0 };
}

/** A diff of one changed line. Each test gets its own text, since coloured
 *  lines are cached across the file. */
function codeDiff(oldText: string, newText: string) {
  return parseDiffLines(['@@ -1,1 +1,1 @@', `-${oldText}`, `+${newText}`, ''].join('\n'));
}

describe('DiffView side by side', () => {
  it('marks hunk rows so hunk navigation can find them', () => {
    const { container } = render(DiffView, { lines, sideBySide: true });
    expect(container.querySelectorAll('[data-hunk]')).toHaveLength(1);
  });

  it('shows a comment on a removed line that sits beside an added one', () => {
    const comments = [comment('old', 6, 'why remove this?'), comment('new', 6, 'nice')];
    const { container } = render(DiffView, { lines, sideBySide: true, comments });
    const bodies = [...container.querySelectorAll('[data-review-comment]')].map(el => el.textContent);
    expect(bodies.some(t => t?.includes('why remove this?'))).toBe(true);
    expect(bodies.some(t => t?.includes('nice'))).toBe(true);
  });
});

describe('DiffView highlighting', () => {
  it('colours lines as it renders by default', () => {
    const { container } = render(DiffView, { lines: codeDiff('const a = 1;', 'const a = 2;'), filePath: 'src/a.ts' });
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const');
  });

  it('with deferHighlight, draws plain lines first and colours them afterwards', async () => {
    const { container } = render(DiffView, { lines: codeDiff('let b = 1;', 'let b = 2;'), filePath: 'src/b.ts', deferHighlight: true });
    expect(container.querySelector('.hljs-keyword')).toBeNull();
    expect(container).toHaveTextContent('let b = 2;');

    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('let'));
    expect(container).toHaveTextContent('let b = 2;');
  });

  it('with deferHighlight, keeps its colours when given the same lines again', async () => {
    const { container, rerender } = render(DiffView, { lines: codeDiff('var c = 1;', 'var c = 2;'), filePath: 'src/c.ts', deferHighlight: true });
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull());

    await rerender({ lines: codeDiff('var c = 1;', 'var c = 2;') });
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('var');
  });

  it('with deferHighlight, leaves a very long line plain and colours the rest', async () => {
    const long = `const minified = [${'1,'.repeat(1200)}];`;
    const { container } = render(DiffView, { lines: codeDiff('const h = 1;', long), filePath: 'src/h.ts', deferHighlight: true });
    await vi.waitFor(() => expect(container.querySelector('.diff-del .hljs-keyword')).not.toBeNull());
    expect(container.querySelector('.diff-add [class^="hljs-"]')).toBeNull();
    expect(container.querySelector('.diff-add')).toHaveTextContent(long);
  });

  it('with deferHighlight, shows lines coloured so far after each slice', async () => {
    // No idle time to spare: one line a slice.
    vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => {
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);
      return 1;
    });
    const { container } = render(DiffView, { lines: codeDiff('const i = 1;', 'return i;'), filePath: 'src/i.ts', deferHighlight: true });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    await flush();
    expect(container.querySelector('.diff-del .hljs-keyword')).toHaveTextContent('const');
    expect(container.querySelector('.diff-add .hljs-keyword')).toBeNull();

    await flush();
    expect(container.querySelector('.diff-add .hljs-keyword')).toHaveTextContent('return');
  });

  it('leaves a file with no known language plain', async () => {
    const { container } = render(DiffView, { lines: codeDiff('const d = 1;', 'const d = 2;'), filePath: 'notes', deferHighlight: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('[class^="hljs-"]')).toBeNull();
  });

  it('keeps markup in a line as text', async () => {
    const text = 'const e = "<img src=x onerror=alert(1)>";';
    const { container } = render(DiffView, { lines: codeDiff('const e = 1;', text), filePath: 'src/e.ts', deferHighlight: true });
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent(text);
  });
});

describe('word marks', () => {
  /** A replacement of two lines, each changing one word. */
  const pairs = (unpaired?: true): DiffLine[] => [
    { type: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { type: 'del', text: 'const v0 = f(0);', lineNum: 1, ...(unpaired ? { unpaired } : {}) },
    { type: 'del', text: 'const v1 = f(1);', lineNum: 2, ...(unpaired ? { unpaired } : {}) },
    { type: 'add', text: 'const v0 = g(0);', lineNum: 1, ...(unpaired ? { unpaired } : {}) },
    { type: 'add', text: 'const v1 = g(1);', lineNum: 2, ...(unpaired ? { unpaired } : {}) },
  ];

  const marks = (lines: DiffLine[], sideBySide: boolean) =>
    render(DiffView, { lines, sideBySide, filePath: 'f.ts' }).container.querySelectorAll('mark.diff-mark').length;

  it('marks the changed words between removed and added lines a diff lined up', () => {
    expect(marks(pairs(), false)).toBe(4);
    expect(marks(pairs(), true)).toBe(4);
  });

  it("doesn't pair lines shown as the old text, then the new: their places say nothing", () => {
    expect(marks(pairs(true), false)).toBe(0);
    expect(marks(pairs(true), true)).toBe(0);
  });
});

describe('conflict markers', () => {
  // `git diff HEAD` for a file a rebase of feat onto main stopped on.
  const conflicted = parseDiffLines(['@@ -1,3 +1,7 @@', ' a', '+<<<<<<< HEAD', ' MAIN', '+=======', '+FEAT', '+>>>>>>> 5150b6c (feat change)', ' c', ''].join('\n'));
  const rebase = { kind: 'rebase' as const, branch: 'feat', incoming: 'main', step: 1, total: 1 };
  /** Each marker line: its role, the line as git wrote it (without the
   *  unified view's line number and +), and its label. */
  const shown = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-conflict-marker]')].map((el) => {
      const label = el.querySelector('[data-conflict-side]')?.textContent ?? null;
      const text = el.textContent!.replace(label ?? '', '').replace(/^\s*\d*\s*\+?\s*/, '').replace(/\s+$/, '');
      return [el.getAttribute('data-conflict-marker'), text, label];
    });

  for (const sideBySide of [false, true]) {
    it(`shows git's markers in amber with each side named (${sideBySide ? 'side by side' : 'unified'})`, () => {
      const { container } = render(DiffView, { lines: conflicted, sideBySide, filePath: 'f.txt', conflict: { operation: rebase } });
      expect(shown(container)).toEqual([
        ['ours', '<<<<<<< HEAD', "↓ main, the branch you're rebasing onto"],
        ['separator', '=======', null],
        ['theirs', '>>>>>>> 5150b6c (feat change)', '↑ your commit'],
      ]);
      for (const el of container.querySelectorAll('[data-conflict-marker]')) expect(el).toHaveClass('text-amber-300');
      // The lines between them are the file's own: still green.
      expect([...container.querySelectorAll('.diff-add')].some((el) => el.textContent?.includes('FEAT'))).toBe(true);
    });

    it(`shows them as ordinary added lines in a file that isn't in conflict (${sideBySide ? 'side by side' : 'unified'})`, () => {
      const { container } = render(DiffView, { lines: conflicted, sideBySide, filePath: 'f.txt' });
      expect(container.querySelector('[data-conflict-marker]')).toBeNull();
      expect(container.textContent).not.toContain('rebasing onto');
    });
  }

  it("keeps git's own words when nothing is under way", () => {
    const { container } = render(DiffView, { lines: conflicted, filePath: 'f.txt', conflict: {} });
    expect(shown(container)[0]).toEqual(['ours', '<<<<<<< HEAD', null]);
  });
});
