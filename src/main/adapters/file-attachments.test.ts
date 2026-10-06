import { describe, it, expect } from 'vitest';
import {
  attachedFilesNote,
  isAudio,
  isInlinePdf,
  isPdf,
  pdfPageCount,
  PDF_INLINE_MAX_BYTES,
  PDF_INLINE_MAX_PAGES,
} from './file-attachments.js';
import type { MessageFile } from './types.js';

/** A minimal uncompressed PDF with `pages` page objects in its page tree. */
function pdf(pages: number): string {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ');
  const objects = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`);
  return [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj`,
    ...objects,
    '%%EOF',
  ].join('\n');
}

function file(over: Partial<MessageFile> & { content?: string } = {}): MessageFile {
  const { content = pdf(2), ...rest } = over;
  const data = Buffer.from(content, 'latin1').toString('base64');
  return { name: 'spec.pdf', mediaType: 'application/pdf', data, path: 'C:\\att\\abc.pdf', size: content.length, ...rest };
}

describe('pdfPageCount', () => {
  it('counts the page objects of an uncompressed PDF', () => {
    expect(pdfPageCount(Buffer.from(pdf(3)))).toBe(3);
  });

  it("reads the page tree's /Count when the page objects are compressed", () => {
    const text = '%PDF-1.5\n2 0 obj << /Type /Pages /Count 40 >> endobj\n5 0 obj << /Type /ObjStm /N 40 >> stream\n...\nendstream';
    expect(pdfPageCount(Buffer.from(text))).toBe(40);
  });

  it('takes the larger count, so stale page objects from an edit err high', () => {
    const edited = `${pdf(2)}\n9 0 obj << /Type /Page >> endobj\n10 0 obj << /Type /Page >> endobj`;
    expect(pdfPageCount(Buffer.from(edited))).toBe(4);
  });

  it("ignores an outline's negative /Count", () => {
    expect(pdfPageCount(Buffer.from(`${pdf(1)}\n8 0 obj << /Type /Outlines /Count -12 >> endobj`))).toBe(1);
  });

  it("is null when it can't tell, or for something that isn't a PDF", () => {
    expect(pdfPageCount(Buffer.from('%PDF-1.5\n5 0 obj << /Type /ObjStm >> stream\nendstream'))).toBeNull();
    expect(pdfPageCount(Buffer.from('PK\x03\x04 a zip /Type /Page'))).toBeNull();
  });
});

describe('isPdf and isAudio', () => {
  it('goes by the type, or by the name when there is no type', () => {
    expect(isPdf({ name: 'a.bin', mediaType: 'application/pdf' })).toBe(true);
    expect(isPdf({ name: 'A.PDF', mediaType: '' })).toBe(true);
    expect(isPdf({ name: 'a.pdf', mediaType: 'application/zip' })).toBe(false);
    expect(isAudio({ mediaType: 'audio/mpeg' })).toBe(true);
    expect(isAudio({ mediaType: 'video/mp4' })).toBe(false);
  });
});

describe('isInlinePdf', () => {
  it('is true for a short, small PDF', () => {
    expect(isInlinePdf(file({ content: pdf(PDF_INLINE_MAX_PAGES) }))).toBe(true);
  });

  it('is false past the page limit, so a long PDF goes by path', () => {
    expect(isInlinePdf(file({ content: pdf(PDF_INLINE_MAX_PAGES + 1) }))).toBe(false);
  });

  it('is false past the size limit', () => {
    expect(isInlinePdf(file({ size: PDF_INLINE_MAX_BYTES + 1 }))).toBe(false);
  });

  it('is false when the pages cannot be counted', () => {
    expect(isInlinePdf(file({ content: '%PDF-1.5\nno page tree in sight' }))).toBe(false);
  });

  it('is false for anything that is not a PDF', () => {
    expect(isInlinePdf(file({ name: 'a.zip', mediaType: 'application/zip' }))).toBe(false);
  });
});

describe('attachedFilesNote', () => {
  it('lists each file with its name, type, size and absolute path', () => {
    const note = attachedFilesNote([
      file({ name: 'budget.xlsx', mediaType: 'application/vnd.ms-excel', size: 1234, path: 'C:\\att\\1.xlsx' }),
      file({ name: 'notes', mediaType: '', size: 5, path: 'C:\\att\\2' }),
    ]);
    expect(note).toBe([
      '<attached_files>',
      'The user attached these files to their message. They are saved outside the project: open them by the absolute path given, an exception to the relative path rule.',
      '<file name="budget.xlsx" type="application/vnd.ms-excel" size="1234" path="C:\\att\\1.xlsx" />',
      '<file name="notes" size="5" path="C:\\att\\2" />',
      '</attached_files>',
    ].join('\n'));
  });

  it('escapes names that would break the attribute', () => {
    expect(attachedFilesNote([file({ name: 'a "b" <c> & d.pdf' })])).toContain('name="a &quot;b&quot; &lt;c> &amp; d.pdf"');
  });
});
