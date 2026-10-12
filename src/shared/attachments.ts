/**
 * The app window loads the images in the Activity thread from each
 * conversation's attachments folder over this scheme (main/attachments.ts),
 * so image data never crosses IPC and Chromium decodes and caches it. Images
 * the agent saved in its worktree load over it too (main/worktree-files.ts).
 * Also the attached file types Grove treats specially, shared by main and
 * the renderer.
 */
import type { MadeFileKind } from './types.js';

export const ATTACHMENT_SCHEME = 'grove-attachment';

/** The URL a stored image loads from. */
export function attachmentImageUrl(sessionId: string, file: string): string {
  return `${ATTACHMENT_SCHEME}://image/${encodeURIComponent(sessionId)}/${encodeURIComponent(file)}`;
}

/** The URL an image in a conversation's worktree loads from: one the agent
 *  linked in a reply, wrote, or made in a turn. `filePath` is as the agent
 *  gave it: relative to the worktree, or absolute inside it. */
export function worktreeFileUrl(sessionId: string, filePath: string): string {
  return `${ATTACHMENT_SCHEME}://worktree/${encodeURIComponent(sessionId)}/${encodeURIComponent(filePath)}`;
}

/** A file name's or path's extension, lower case: '' for none, and for a
 *  name that only starts with a dot (`.env`). The one parser the helpers
 *  below share, so a name is never read two ways. */
function extOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Images the thread shows from the worktree, by extension. Wider than what
 *  goes to the model (ImageMediaType): Chromium draws these in an <img>,
 *  where an SVG can't run scripts. */
const WORKTREE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

/** The MIME type of an image the thread shows from the worktree, else ''. */
export function worktreeImageType(name: string): string {
  const ext = extOf(name);
  return Object.hasOwn(WORKTREE_IMAGE_TYPES, ext) ? WORKTREE_IMAGE_TYPES[ext] : '';
}

/** The files a turn's "Files made" list picks out, by extension: output to
 *  look at, not source code. Formats that can hold macros (.docm, .xlsm, the
 *  old .xls, and OpenDocument's .odt/.ods/.odp) are left out, since a click
 *  opens them. */
const MADE_FILE_KINDS: Readonly<Record<string, MadeFileKind>> = {
  ...Object.fromEntries(Object.keys(WORKTREE_IMAGE_TYPES).filter((e) => e !== 'ico').map((e) => [e, 'image' as const])),
  pdf: 'pdf',
  html: 'html',
  htm: 'html',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  csv: 'data',
  tsv: 'data',
  xlsx: 'data',
  docx: 'document',
  pptx: 'document',
};

/** The kind of a file a turn's "Files made" list shows, or null for one it
 *  leaves out (source code, logs, anything else). */
export function madeFileKind(name: string): MadeFileKind | null {
  const ext = extOf(name);
  return Object.hasOwn(MADE_FILE_KINDS, ext) ? MADE_FILE_KINDS[ext] : null;
}

/** MIME types for the attached files Grove treats specially, by extension:
 *  PDFs and audio open in their default app from the thread, and audio can go
 *  inline to agents that take it. Also fills in the type when the browser
 *  reports none (on Windows it only knows what the registry has). */
const MEDIA_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

/** The MIME type for a file name's extension when it is one of those, else ''. */
export function knownMediaType(name: string): string {
  const ext = extOf(name);
  return Object.hasOwn(MEDIA_TYPE_BY_EXT, ext) ? MEDIA_TYPE_BY_EXT[ext] : '';
}

export function isPdfType(mediaType: string): boolean {
  return mediaType === 'application/pdf';
}

export function isAudioType(mediaType: string): boolean {
  return mediaType.startsWith('audio/');
}
