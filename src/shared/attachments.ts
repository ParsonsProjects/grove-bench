/**
 * The app window loads the images in the Activity thread from each
 * conversation's attachments folder over this scheme (main/attachments.ts),
 * so image data never crosses IPC and Chromium decodes and caches it.
 */
export const ATTACHMENT_SCHEME = 'grove-attachment';

/** The URL a stored image loads from. */
export function attachmentImageUrl(sessionId: string, file: string): string {
  return `${ATTACHMENT_SCHEME}://image/${encodeURIComponent(sessionId)}/${encodeURIComponent(file)}`;
}
