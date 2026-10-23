import { describe, it, expect } from 'vitest';
import { isAudioType, isMarkdownFile, isPdfType, knownMediaType, madeFileKind, worktreeFileUrl, worktreeImageType } from './attachments.js';

describe('knownMediaType', () => {
  it('gives the type for PDFs and audio, whatever the case of the extension', () => {
    expect(knownMediaType('Spec.PDF')).toBe('application/pdf');
    expect(knownMediaType('memo.mp3')).toBe('audio/mpeg');
    expect(knownMediaType('memo.wav')).toBe('audio/wav');
  });

  it('is empty for other types and for names without an extension', () => {
    expect(knownMediaType('data.zip')).toBe('');
    expect(knownMediaType('README')).toBe('');
  });

  it('is empty for extensions that name Object.prototype members', () => {
    expect(knownMediaType('x.constructor')).toBe('');
    expect(knownMediaType('x.__proto__')).toBe('');
    expect(knownMediaType('x.toString')).toBe('');
  });
});

describe('isPdfType and isAudioType', () => {
  it('go by the MIME type', () => {
    expect(isPdfType('application/pdf')).toBe(true);
    expect(isPdfType('')).toBe(false);
    expect(isAudioType('audio/ogg')).toBe(true);
    expect(isAudioType('video/mp4')).toBe(false);
  });
});

describe('madeFileKind', () => {
  it('sorts output files by kind, from a name or a path', () => {
    expect(madeFileKind('shots/home.PNG')).toBe('image');
    expect(madeFileKind('C:\\wt\\chart.svg')).toBe('image');
    expect(madeFileKind('report.pdf')).toBe('pdf');
    expect(madeFileKind('report/index.htm')).toBe('html');
    expect(madeFileKind('demo.webm')).toBe('video');
    expect(madeFileKind('memo.m4a')).toBe('audio');
    expect(madeFileKind('data.csv')).toBe('data');
    expect(madeFileKind('deck.pptx')).toBe('document');
  });

  it('leaves out source code, and formats that can hold macros', () => {
    for (const name of ['app.ts', 'notes.md', 'macro.xlsm', 'old.xls', 'letter.docm', 'notes.odt', 'sheet.ods', 'deck.odp', 'favicon.ico']) {
      expect(madeFileKind(name)).toBeNull();
    }
  });

  it('reads the extension from the file name, not a dot in a folder', () => {
    expect(madeFileKind('v1.2/README')).toBeNull();
    expect(madeFileKind('.png')).toBeNull();
    expect(madeFileKind('x.constructor')).toBeNull();
  });
});

describe('worktreeImageType', () => {
  it('knows the images the thread draws, SVG included', () => {
    expect(worktreeImageType('a/b.svg')).toBe('image/svg+xml');
    expect(worktreeImageType('shot.JPG')).toBe('image/jpeg');
    expect(worktreeImageType('favicon.ico')).toBe('image/x-icon');
    expect(worktreeImageType('notes.txt')).toBe('');
    expect(worktreeImageType('.env')).toBe('');
  });
});

describe('worktreeFileUrl', () => {
  it('encodes the path as one segment, so it can hold slashes and a drive', () => {
    expect(worktreeFileUrl('s1', 'shots/home.png')).toBe('grove-attachment://worktree/s1/shots%2Fhome.png');
    expect(worktreeFileUrl('s1', 'C:\\wt\\a b.svg')).toBe('grove-attachment://worktree/s1/C%3A%5Cwt%5Ca%20b.svg');
  });
});

describe('isMarkdownFile', () => {
  it('knows a Markdown file by its extension, in any case', () => {
    expect(isMarkdownFile('docs/plan.md')).toBe(true);
    expect(isMarkdownFile('NOTES.Markdown')).toBe(true);
    expect(isMarkdownFile('notes.mdx')).toBe(false);
    expect(isMarkdownFile('md')).toBe(false);
  });
});
