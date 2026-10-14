import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';

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
