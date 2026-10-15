import { describe, it, expect, vi } from 'vitest';
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

import DiffBlock from './DiffBlock.svelte';
import type { ToolView } from '../../shared/tool-view.js';

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
