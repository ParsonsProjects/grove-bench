/**
 * The app window loads the images in the Activity thread from each
 * conversation's attachments folder over this scheme (main/attachments.ts),
 * so image data never crosses IPC and Chromium decodes and caches it.
 * Also the attached file types Grove treats specially, shared by main and
 * the renderer.
 */
export const ATTACHMENT_SCHEME = 'grove-attachment';

/** The URL a stored image loads from. */
export function attachmentImageUrl(sessionId: string, file: string): string {
  return `${ATTACHMENT_SCHEME}://image/${encodeURIComponent(sessionId)}/${encodeURIComponent(file)}`;
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
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return Object.hasOwn(MEDIA_TYPE_BY_EXT, ext) ? MEDIA_TYPE_BY_EXT[ext] : '';
}

export function isPdfType(mediaType: string): boolean {
  return mediaType === 'application/pdf';
}

export function isAudioType(mediaType: string): boolean {
  return mediaType.startsWith('audio/');
}
