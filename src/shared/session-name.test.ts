import { describe, it, expect } from 'vitest';
import { deriveSessionName, legacySessionName, stripFileContext } from './session-name.js';

describe('deriveSessionName', () => {
  it('trims a short message and capitalises a plain first word', () => {
    expect(deriveSessionName('  fix the login bug  ')).toBe('Fix the login bug');
  });

  it('leaves identifiers and paths at the start as typed', () => {
    expect(deriveSessionName('useEffect runs twice')).toBe('useEffect runs twice');
    expect(deriveSessionName('src/foo.ts is broken')).toBe('src/foo.ts is broken');
    expect(deriveSessionName('readme.md needs a usage section')).toBe('readme.md needs a usage section');
    expect(deriveSessionName('fix, then test the parser')).toBe('Fix, then test the parser');
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
    expect(deriveSessionName('fix\n\n  the   bug')).toBe('Fix the bug');
  });

  it('strips surrounding backticks and quotes and leading markdown markers', () => {
    expect(deriveSessionName('`fix the bug`')).toBe('Fix the bug');
    expect(deriveSessionName('"add OAuth"')).toBe('Add OAuth');
    expect(deriveSessionName('## Add login screen')).toBe('Add login screen');
    expect(deriveSessionName('- do the thing')).toBe('Do the thing');
  });

  it('returns null when nothing meaningful remains after stripping', () => {
    expect(deriveSessionName('###')).toBeNull();
    expect(deriveSessionName('``` ```')).toBeNull();
  });

  it('drops a leading attachment list so the name reflects the instruction', () => {
    expect(
      deriveSessionName('[src/components/Foo.svelte, src/lib/bar.ts] fix the rendering bug'),
    ).toBe('Fix the rendering bug');
  });

  it('skips file content blocks prepended to the sent message', () => {
    const sent = '<file path="a.ts">\nconst a = 1;\n\n</file>\n<folder path="src/">\n(could not read)\n</folder>\n\ncan you fix the parser';
    expect(deriveSessionName(sent)).toBe('Fix the parser');
  });

  it('returns null for an attachment-only message (no instruction text)', () => {
    expect(deriveSessionName('[a.ts, b.ts] ')).toBeNull();
  });

  it('drops leading @-mention file refs', () => {
    expect(deriveSessionName('@src/foo.ts refactor the parser')).toBe('Refactor the parser');
    expect(deriveSessionName('@a.ts @b.ts add tests')).toBe('Add tests');
    expect(deriveSessionName('@src/only.ts')).toBeNull();
  });

  it('drops filler openers so similar prompts get distinct names', () => {
    expect(deriveSessionName('Can you look at the sidebar sort order')).toBe('Sidebar sort order');
    expect(deriveSessionName('Can you look at the flaky e2e retries')).toBe('Flaky e2e retries');
    expect(deriveSessionName('Please add dark mode')).toBe('Add dark mode');
    expect(deriveSessionName('I want to rename the settings panel')).toBe('Rename the settings panel');
    expect(deriveSessionName("I'd like you to refactor git.ts")).toBe('Refactor git.ts');
    expect(deriveSessionName('I’d like you to refactor git.ts')).toBe('Refactor git.ts');
  });

  it('drops stacked openers and a leading article', () => {
    expect(deriveSessionName('Hi, could you please take a look at the OAuth refresh')).toBe('OAuth refresh');
    expect(deriveSessionName('Hey Claude, can you fix the build?')).toBe('Fix the build?');
    expect(deriveSessionName('The sidebar names are too similar')).toBe('Sidebar names are too similar');
  });

  it('only matches openers as whole words', () => {
    expect(deriveSessionName('Helper for date parsing')).toBe('Helper for date parsing');
    expect(deriveSessionName('A/B test the banner')).toBe('A/B test the banner');
    expect(deriveSessionName('Letsencrypt renewal fails')).toBe('Letsencrypt renewal fails');
  });

  it('keeps the original words when the prompt is only filler', () => {
    expect(deriveSessionName('Can you please')).toBe('Can you please');
    expect(deriveSessionName('please')).toBe('Please');
  });

  it('drops trailing sentence punctuation but keeps question marks', () => {
    expect(deriveSessionName('Fix the login bug.')).toBe('Fix the login bug');
    expect(deriveSessionName('How does memory autosave work?')).toBe('How does memory autosave work?');
  });

  it('truncates long text on a word boundary with an ellipsis', () => {
    const result = deriveSessionName('Please add OAuth login with Google and GitHub providers to the app')!;
    expect(result.startsWith('Add OAuth login')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    // <= 40 chars of text + the ellipsis
    expect(result.length).toBeLessThanOrEqual(41);
    // Truncates on whole words — the original contains the kept prefix verbatim.
    const kept = result.slice(0, -1);
    expect('add OAuth login with Google and GitHub providers to the app').toContain(kept.slice(1));
  });
});

describe('legacySessionName', () => {
  it('reproduces the old names: cleaned prompt, no filler stripping or capitalising', () => {
    expect(legacySessionName('  fix the login bug  ')).toBe('fix the login bug');
    expect(legacySessionName('Can you look at the sidebar sort order')).toBe('Can you look at the sidebar sort order');
    expect(legacySessionName('[a.ts] `fix` the bug.')).toBe('fix the bug.');
    expect(legacySessionName('Please add OAuth login with Google and GitHub providers to the app'))
      .toBe('Please add OAuth login with Google and…');
  });

  it('returns null where the old heuristic gave no name', () => {
    expect(legacySessionName('')).toBeNull();
    expect(legacySessionName('/clear')).toBeNull();
    expect(legacySessionName('@src/only.ts')).toBeNull();
  });
});

describe('stripFileContext', () => {
  it('removes leading file and folder blocks, including empty ones', () => {
    expect(stripFileContext('<file path="a.ts">\n\n</file>\n\nfix it')).toBe('fix it');
    expect(stripFileContext('<file path="a.ts">\nx\n</file>\n<file path="b.ts">\ny\n</file>\n\nfix it')).toBe('fix it');
  });

  it('leaves text without leading blocks untouched', () => {
    expect(stripFileContext('fix <file path="a.ts"> handling')).toBe('fix <file path="a.ts"> handling');
    expect(stripFileContext('plain prompt')).toBe('plain prompt');
  });
});
