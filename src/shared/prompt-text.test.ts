import { describe, it, expect } from 'vitest';
import { attachedFilesFromSent, buildContentBlock, displayTextFromSent, parseSentPrompt, stripFileContext } from './prompt-text.js';

describe('parseSentPrompt', () => {
  it('reads past a closing tag inside the file content, using its length', () => {
    const xml = '<root>\n</file>\n<secret>REST OF FILE</secret>\n</root>';
    const sent = `${buildContentBlock('file', 'docs/manifest.xml', xml)}\n${buildContentBlock('folder', 'src/', 'a.ts')}\n\nplease fix @docs/manifest.xml`;
    expect(parseSentPrompt(sent)).toEqual({ paths: ['docs/manifest.xml', 'src/'], typed: 'please fix @docs/manifest.xml' });
  });

  it('falls back to the first closing tag when the length does not line up', () => {
    const sent = '<file path="a.ts" length="999">\nx\n</file>\n\ntyped';
    expect(parseSentPrompt(sent)).toEqual({ paths: ['a.ts'], typed: 'typed' });
  });

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

describe('attachedFilesFromSent', () => {
  it('returns attached files with their content, leaving @-references in the text', () => {
    const sent = `${buildContentBlock('file', 'notes.md', 'see </file> here')}\n${buildContentBlock('file', 'src/a.ts', 'const a = 1;')}\n\nfollow the notes for @src/a.ts`;
    expect(attachedFilesFromSent(sent)).toEqual({
      files: [{ path: 'notes.md', content: 'see </file> here' }],
      typed: 'follow the notes for @src/a.ts',
    });
  });

  it('reads the content of blocks sent before `length` was added', () => {
    expect(attachedFilesFromSent('<file path="a.ts">\nold\n</file>\n\ntyped')).toEqual({
      files: [{ path: 'a.ts', content: 'old' }],
      typed: 'typed',
    });
  });

  it('keeps an attached file that has the same name as an @-reference', () => {
    const sent = `${buildContentBlock('file', 'README.md', 'dropped copy')}\n${buildContentBlock('file', 'README.md', 'worktree copy')}\n\ncompare with @README.md`;
    expect(attachedFilesFromSent(sent).files).toEqual([{ path: 'README.md', content: 'dropped copy' }]);
  });

  it('takes one block off per @-reference, repeated references included', () => {
    const sent = `${buildContentBlock('file', 'a.ts', '1')}\n${buildContentBlock('file', 'a.ts', '1')}\n\n@a.ts and again @a.ts`;
    expect(attachedFilesFromSent(sent).files).toEqual([]);
  });

  it('still takes @-reference blocks off when one reference has no block', () => {
    // Messages from before unreadable references got a "(could not read)" block.
    const sent = `${buildContentBlock('file', 'notes.md', 'n')}\n${buildContentBlock('file', 'src/a.ts', 'a')}\n\n@src/a.ts and @missing.ts`;
    expect(attachedFilesFromSent(sent).files).toEqual([{ path: 'notes.md', content: 'n' }]);
  });

  it('returns no files for a plain prompt', () => {
    expect(attachedFilesFromSent('plain prompt')).toEqual({ files: [], typed: 'plain prompt' });
  });
});

describe('displayTextFromSent with images', () => {
  it('lists attached files, then images, before the typed text', () => {
    const sent = `${buildContentBlock('file', 'a.ts', 'x')}\n\nfix it`;
    expect(displayTextFromSent(sent, [{ name: 'shot.png' }, {}])).toBe('[a.ts, shot.png] fix it');
  });
});
