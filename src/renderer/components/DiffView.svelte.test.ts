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
import type { ReviewComment } from '../lib/diff-types.js';

afterEach(() => cleanup());

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

  it('with deferHighlight, shows colours already worked out straight away', async () => {
    const diff = codeDiff('var c = 1;', 'var c = 2;');
    render(DiffView, { lines: diff, filePath: 'src/c.ts' });
    cleanup();
    const { container } = render(DiffView, { lines: diff, filePath: 'src/c.ts', deferHighlight: true });
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('var');
  });

  it('with deferHighlight, draws new lines plain first even once earlier ones are coloured', async () => {
    const { container, rerender } = render(DiffView, { lines: codeDiff('let f = 1;', 'let f = 2;'), filePath: 'src/f.ts', deferHighlight: true });
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull());

    await rerender({ lines: codeDiff('function g() {}', 'function g() { return 1; }') });
    expect(container).toHaveTextContent('function g() { return 1; }');
    expect(container.querySelector('.hljs-keyword')).toBeNull();
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('function'));
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
