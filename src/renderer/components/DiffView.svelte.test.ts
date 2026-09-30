import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

import DiffView from './DiffView.svelte';
import { parseDiffLines } from '../lib/diff-parse.js';
import type { ReviewComment } from '../lib/diff-types.js';

afterEach(() => cleanup());

const lines = parseDiffLines(['@@ -5,2 +5,2 @@', ' keep();', '-oldCall();', '+newCall();', ''].join('\n'));

function comment(side: 'old' | 'new', line: number, body: string): ReviewComment {
  return { id: body, filePath: 'f.ts', side, startLine: line, endLine: line, snippet: '', body, createdAt: 0 };
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
