import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from './review-prompt.js';
import type { ReviewComment } from './diff-types.js';

const c = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'x', filePath: 'src/a.ts', side: 'new', startLine: 5, endLine: 5, snippet: 'const a = 1;', body: 'Use let', createdAt: 0, ...over,
});

describe('buildReviewPrompt', () => {
  it('returns an empty string with no comments', () => {
    expect(buildReviewPrompt([])).toBe('');
  });

  it('groups by file, orders by line, and fences the snippet with the file language', () => {
    const out = buildReviewPrompt([
      c({ id: '1', startLine: 20, endLine: 22, snippet: 'b', body: 'second' }),
      c({ id: '2', filePath: 'docs/x.md', startLine: 1, endLine: 1, snippet: '# t', body: 'other file' }),
      c({ id: '3', startLine: 5, endLine: 5, body: 'first' }),
    ]);
    expect(out).toContain('3 review comments');
    expect(out.indexOf('### src/a.ts:5')).toBeLessThan(out.indexOf('### src/a.ts:20-22'));
    expect(out).toContain('```ts\nconst a = 1;\n```');
    expect(out).toContain('### docs/x.md:1');
    expect(out).toContain('```md\n# t\n```');
  });

  it('flags comments on removed lines', () => {
    expect(buildReviewPrompt([c({ side: 'old' })])).toContain('(removed lines)');
  });
});
