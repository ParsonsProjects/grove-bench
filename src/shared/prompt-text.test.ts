import { describe, it, expect } from 'vitest';
import { displayTextFromSent, parseSentPrompt, stripFileContext } from './prompt-text.js';

describe('parseSentPrompt', () => {
  it('splits leading file and folder blocks from the typed text', () => {
    const sent = '<file path="a.ts">\nconst a = 1;\n\n</file>\n<folder path="src/">\n(could not read)\n</folder>\n\nfix the parser';
    expect(parseSentPrompt(sent)).toEqual({ paths: ['a.ts', 'src/'], typed: 'fix the parser' });
  });

  it('handles empty blocks and a message with no typed text', () => {
    expect(parseSentPrompt('<file path="a.ts">\n\n</file>\n\n')).toEqual({ paths: ['a.ts'], typed: '' });
  });

  it('leaves text without leading blocks untouched', () => {
    expect(parseSentPrompt('fix <file path="a.ts"> handling')).toEqual({ paths: [], typed: 'fix <file path="a.ts"> handling' });
    expect(parseSentPrompt('plain prompt')).toEqual({ paths: [], typed: 'plain prompt' });
  });
});

describe('stripFileContext', () => {
  it('returns only the typed text', () => {
    expect(stripFileContext('<file path="a.ts">\nx\n</file>\n<file path="b.ts">\ny\n</file>\n\nfix it')).toBe('fix it');
    expect(stripFileContext('plain prompt')).toBe('plain prompt');
  });
});

describe('displayTextFromSent', () => {
  it('drops blocks for @-references, which stay in the text', () => {
    expect(displayTextFromSent('<file path="src/a.ts">\nx\n</file>\n<folder path="lib/">\ny\n</folder>\n\nexplain @src/a.ts and @lib/'))
      .toBe('explain @src/a.ts and @lib/');
  });

  it('labels attached files the way the prompt editor did', () => {
    expect(displayTextFromSent('<file path="a.ts">\nx\n</file>\n<file path="b.ts">\ny\n</file>\n\nfix these'))
      .toBe('[a.ts, b.ts] fix these');
  });

  it('labels only the attachments when both kinds are present', () => {
    // Attachments come first, then @-references, as the editor builds them.
    expect(displayTextFromSent('<file path="notes.md">\nn\n</file>\n<file path="src/a.ts">\nx\n</file>\n\nfollow notes for @src/a.ts'))
      .toBe('[notes.md] follow notes for @src/a.ts');
  });

  it('does not treat a longer @-reference as a match for an attachment', () => {
    expect(displayTextFromSent('<file path="a.ts">\nx\n</file>\n\ncompare with @a.tsx'))
      .toBe('[a.ts] compare with @a.tsx');
  });

  it('returns plain messages unchanged', () => {
    expect(displayTextFromSent('fix the bug')).toBe('fix the bug');
  });
});
