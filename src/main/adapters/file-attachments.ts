/**
 * How adapters pass on the files attached to a message that go neither as
 * text nor as an image (MessageFile). The session manager saves each one to
 * the conversation's attachments folder first, so any agent can be given the
 * path; a small PDF, or audio for an agent that takes it, goes inline instead.
 */
import type { MessageFile } from './types.js';

/** A PDF goes inline only up to this many pages. Each page costs about
 *  1,500-3,000 text tokens plus an image, so a long one would crowd out the
 *  conversation; past this the agent reads the pages it needs by path. */
export const PDF_INLINE_MAX_PAGES = 10;
/** And only up to this size, well under the API's 32 MB request limit. */
export const PDF_INLINE_MAX_BYTES = 5 * 1024 * 1024;

export function isPdf(file: Pick<MessageFile, 'name' | 'mediaType'>): boolean {
  return file.mediaType === 'application/pdf' || (!file.mediaType && /\.pdf$/i.test(file.name));
}

export function isAudio(file: Pick<MessageFile, 'mediaType'>): boolean {
  return file.mediaType.startsWith('audio/');
}

/**
 * A PDF's page count, or null when it can't tell (not a PDF, or its page
 * objects are packed into compressed object streams). Takes the larger of
 * the page objects counted and the page tree's /Count, so a file edited in
 * place (old page objects left behind) errs high: that only means it goes
 * by path.
 */
export function pdfPageCount(pdf: Buffer): number | null {
  // The header may follow up to 1 KB of other bytes.
  if (pdf.subarray(0, 1024).indexOf('%PDF-') < 0) return null;
  const text = pdf.toString('latin1');
  const objects = text.match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  let tree = 0;
  for (const m of text.matchAll(/\/Count\s+(\d+)/g)) tree = Math.max(tree, Number(m[1]));
  const pages = Math.max(objects, tree);
  return pages > 0 ? pages : null;
}

/** Whether a PDF is small enough to send inline. One whose pages can't be
 *  counted isn't: by path is safe at any size. */
export function isInlinePdf(file: MessageFile): boolean {
  if (!isPdf(file) || file.size > PDF_INLINE_MAX_BYTES) return false;
  const pages = pdfPageCount(Buffer.from(file.data, 'base64'));
  return pages !== null && pages <= PDF_INLINE_MAX_PAGES;
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Text that tells the agent where the files it gets by path are. Grove's
 * system prompt asks for relative paths, so it says these are the exception.
 */
export function attachedFilesNote(files: MessageFile[]): string {
  return [
    '<attached_files>',
    'The user attached these files to their message. They are saved outside the project: open them by the absolute path given, an exception to the relative path rule.',
    ...files.map((f) => `<file name="${attr(f.name)}"${f.mediaType ? ` type="${attr(f.mediaType)}"` : ''} size="${f.size}" path="${attr(f.path)}" />`),
    '</attached_files>',
  ].join('\n');
}
