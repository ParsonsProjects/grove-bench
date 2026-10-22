import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window so highlight.js spans survive it.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});

// Spied on, to see whether a diff was worked out at all.
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>();
  return { ...actual, createPatch: vi.fn(actual.createPatch) };
});

import { createPatch } from 'diff';
const { createPatch: realCreatePatch } = await vi.importActual<typeof import('diff')>('diff');
import DiffBlock from './DiffBlock.svelte';
import type { ToolView } from '../../shared/tool-view.js';

/** A number as the notice shows it, spaced as Testing Library reads text. */
const count = (n: number) => n.toLocaleString().replace(/\s/g, ' ');

const edit: ToolView = { kind: 'edit', path: 'src/server.ts', edits: [{ oldText: 'let retries = 1;', newText: 'let retries = 3;' }] };

describe('DiffBlock', () => {
  it('colours an edit by the file\'s language once it is on screen', async () => {
    const { container } = render(DiffBlock, { sessionId: 's1', view: edit, pending: false });
    expect(container).toHaveTextContent('let retries = 3;');
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('let'));
  });

  it('colours a new file too', async () => {
    const write: ToolView = { kind: 'edit', path: 'scripts/build.py', write: 'def build():\n    return 1' };
    const { container } = render(DiffBlock, { sessionId: 's1', view: write, pending: false });
    await vi.waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('def'));
  });
});

describe('DiffBlock Markdown preview', () => {
  it('offers to read a Markdown file as it renders', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'markdown', content: '# Notes' });
    const write: ToolView = { kind: 'edit', path: 'docs/notes.md', write: '# Notes' };
    render(DiffBlock, { sessionId: 's1', view: write, pending: false });
    await fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    expect(mockGroveBench.openWorktreeFile).toHaveBeenCalledWith('s1', 'docs/notes.md');
    expect(markdownPreviewStore).toMatchObject({ open: true, content: '# Notes' });
    markdownPreviewStore.close();
  });

  it('says when the file is gone', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'missing' });
    render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'gone.md', write: 'x' }, pending: false });
    await fireEvent.click(screen.getByRole('button', { name: 'preview' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'preview' })).toBeDisabled());
  });

  it('isn\'t offered for other files', () => {
    render(DiffBlock, { sessionId: 's1', view: edit, pending: false });
    expect(screen.queryByRole('button', { name: 'preview' })).toBeNull();
  });
});

describe('DiffBlock large edits', () => {
  // One long line: large by characters, and quick to draw once shown.
  const big = 'x'.repeat(150_000) + 'END';
  // 2,002 lines across both sides: large by lines, yet quick to diff.
  const wide = Array.from({ length: 1001 }, (_, i) => `line ${i}`);

  it('holds a large write back until asked, then draws it', async () => {
    const { container } = render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'dist/app.min.js', write: big }, pending: false });
    expect(screen.getByText(`Large edit (1 line, ${count(150_003)} characters of text)`, { exact: false })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('END');
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to dist/app.min.js' }));
    expect(container).toHaveTextContent('END');
    expect(screen.queryByText(/Large edit/)).toBeNull();
  });

  it('shows a small change to a large file at once', () => {
    // ACP agents can send the whole file before and after.
    const after = [...wide];
    after[500] = 'the one changed line';
    const { container } = render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'notes.txt', edits: [{ oldText: wide.join('\n'), newText: after.join('\n') }] }, pending: false });
    expect(screen.queryByText(/Large edit/)).toBeNull();
    expect(container).toHaveTextContent('the one changed line');
  });

  it('gives a heavily changed large file one capped try before holding it back', () => {
    vi.mocked(createPatch).mockClear();
    const reversed = [...wide].reverse();
    render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'notes.txt', edits: [{ oldText: wide.join('\n'), newText: reversed.join('\n') }] }, pending: false });
    expect(screen.getByText(/Large edit/)).toBeInTheDocument();
    // Reversed, 1,001 lines need about 2,000 changes, past the cap.
    expect(createPatch).toHaveBeenCalledOnce();
    expect(vi.mocked(createPatch).mock.calls[0][5]).toMatchObject({ maxEditLength: 500 });
  });

  it('holds back a small diff with a huge line, then draws the lines it already has', async () => {
    vi.mocked(createPatch).mockClear();
    const { container } = render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'docs/data.md', edits: [{ oldText: 'a', newText: big }] }, pending: false });
    expect(screen.getByText(/Large edit/)).toBeInTheDocument();
    // The header keeps its actions, but side-by-side waits for the diff.
    expect(screen.getByRole('button', { name: 'preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'side-by-side' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to docs/data.md' }));
    expect(container).toHaveTextContent('END');
    expect(screen.getByRole('button', { name: 'side-by-side' })).toBeInTheDocument();
    expect(createPatch).toHaveBeenCalledOnce();
  });

  /** Makes the capped diffs give up, as if out of time: the quick try only
   *  (it has maxEditLength), or the full one after "Show edit" too. */
  function capsGiveUp(which: 'quick' | 'all') {
    vi.mocked(createPatch).mockImplementation(((...args: Parameters<typeof realCreatePatch>) => {
      const opts = args[5] as { timeout?: number; maxEditLength?: number } | undefined;
      if (opts?.timeout && (which === 'all' || opts.maxEditLength)) return undefined;
      return realCreatePatch(...args);
    }) as typeof createPatch);
  }
  afterEach(() => { vi.mocked(createPatch).mockImplementation(realCreatePatch); });

  it('works out a held-back edit in full once asked', async () => {
    capsGiveUp('quick');
    const { container } = render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'dist/app.min.js', edits: [{ oldText: 'a', newText: big }] }, pending: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to dist/app.min.js' }));
    const full = vi.mocked(createPatch).mock.calls.at(-1)![5] as { timeout: number };
    expect(full.timeout).toBeGreaterThan(500);
    expect(full).not.toHaveProperty('maxEditLength');
    expect(container).toHaveTextContent('END');
  });

  it('says when a shown edit has too many changes to work out, and offers the editor', async () => {
    capsGiveUp('all');
    mockGroveBench.openInEditor.mockClear();
    render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'docs/data.md', edits: [{ oldText: 'a', newText: big }] }, pending: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Show edit to docs/data.md' }));
    expect(screen.getByText('Too many changes to show here.')).toBeInTheDocument();
    // The header keeps its actions; side-by-side has nothing to show.
    expect(screen.getByRole('button', { name: 'preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'side-by-side' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }));
    expect(mockGroveBench.openInEditor).toHaveBeenCalledWith('s1', 'docs/data.md');
  });

  it('says nothing about size until the write has come in', async () => {
    const { rerender } = render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', path: 'dist/app.min.js', write: big }, pending: true });
    expect(screen.queryByText(/Large edit/)).toBeNull();
    await rerender({ pending: false });
    expect(screen.getByText(/Large edit/)).toBeInTheDocument();
  });

  it('names the button plainly for an edit with no path', () => {
    render(DiffBlock, { sessionId: 's1', view: { kind: 'edit', write: big }, pending: false });
    expect(screen.getByRole('button', { name: 'Show edit' })).toBeInTheDocument();
  });
});
