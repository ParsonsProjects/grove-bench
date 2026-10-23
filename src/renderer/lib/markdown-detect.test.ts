import { describe, it, expect } from 'vitest';
import { isPreviewableMarkdown } from './markdown-detect.js';

describe('isPreviewableMarkdown()', () => {
  it('accepts a plan with multiple headings', () => {
    expect(isPreviewableMarkdown('## Step 1\nDo the thing\n\n## Step 2\nVerify it')).toBe(true);
  });

  it('accepts any response containing a table', () => {
    expect(isPreviewableMarkdown('Results:\n\n| Module | Coverage |\n| --- | --- |\n| ipc | 0% |')).toBe(true);
  });

  it('accepts three or more fenced code blocks', () => {
    const fence = '```ts\nconst a = 1;\n```\n';
    expect(isPreviewableMarkdown(fence + fence + fence)).toBe(true);
  });

  it('accepts long structured content via the length threshold', () => {
    const text = '# Audit\n' + '- finding item here\n'.repeat(120);
    expect(isPreviewableMarkdown(text)).toBe(true);
  });

  it('rejects short conversational replies with light formatting', () => {
    expect(isPreviewableMarkdown('Done — the fix was in `terminal.ts`, one **bold** word.')).toBe(false);
  });

  it('rejects a single code fence with a short explanation', () => {
    expect(isPreviewableMarkdown('Here you go:\n```ts\nconst a = 1;\n```')).toBe(false);
  });

  it('rejects a short flat list without headings', () => {
    expect(isPreviewableMarkdown('- one\n- two\n- three')).toBe(false);
  });

  it('rejects long plain prose with no markdown structure', () => {
    expect(isPreviewableMarkdown('word '.repeat(400))).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isPreviewableMarkdown('')).toBe(false);
  });

  it('ignores heading-like lines inside code fences', () => {
    const text = '```\n# not a heading\n# also not\n```';
    expect(isPreviewableMarkdown(text)).toBe(false);
  });
});
