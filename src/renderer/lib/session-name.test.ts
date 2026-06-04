import { describe, it, expect } from 'vitest';
import { deriveSessionName } from './session-name.js';

describe('deriveSessionName', () => {
  it('trims and returns a short message as-is', () => {
    expect(deriveSessionName('  fix the login bug  ')).toBe('fix the login bug');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(deriveSessionName('')).toBeNull();
    expect(deriveSessionName('   \n  ')).toBeNull();
  });

  it('returns null for slash commands', () => {
    expect(deriveSessionName('/clear')).toBeNull();
    expect(deriveSessionName('  /compact now')).toBeNull();
  });

  it('collapses internal whitespace and newlines', () => {
    expect(deriveSessionName('fix\n\n  the   bug')).toBe('fix the bug');
  });

  it('strips surrounding backticks and quotes and leading markdown markers', () => {
    expect(deriveSessionName('`fix the bug`')).toBe('fix the bug');
    expect(deriveSessionName('"add OAuth"')).toBe('add OAuth');
    expect(deriveSessionName('## Add login screen')).toBe('Add login screen');
    expect(deriveSessionName('- do the thing')).toBe('do the thing');
  });

  it('returns null when nothing meaningful remains after stripping', () => {
    expect(deriveSessionName('###')).toBeNull();
    expect(deriveSessionName('``` ```')).toBeNull();
  });

  it('drops a leading attachment list so the name reflects the instruction', () => {
    expect(
      deriveSessionName('[src/components/Foo.svelte, src/lib/bar.ts] fix the rendering bug'),
    ).toBe('fix the rendering bug');
  });

  it('returns null for an attachment-only message (no instruction text)', () => {
    expect(deriveSessionName('[a.ts, b.ts] ')).toBeNull();
  });

  it('drops leading @-mention file refs', () => {
    expect(deriveSessionName('@src/foo.ts refactor the parser')).toBe('refactor the parser');
    expect(deriveSessionName('@a.ts @b.ts add tests')).toBe('add tests');
    expect(deriveSessionName('@src/only.ts')).toBeNull();
  });

  it('truncates long text on a word boundary with an ellipsis', () => {
    const result = deriveSessionName('Please add OAuth login with Google and GitHub providers to the app')!;
    expect(result.startsWith('Please add OAuth')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    // <= 40 chars of text + the ellipsis
    expect(result.length).toBeLessThanOrEqual(41);
    // Truncates on whole words — the original contains the kept prefix verbatim.
    const kept = result.slice(0, -1);
    expect('Please add OAuth login with Google and GitHub providers to the app').toContain(kept);
  });
});
