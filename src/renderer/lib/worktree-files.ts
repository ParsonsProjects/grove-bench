/**
 * Files in a thread's worktree that the thread links to: images and links in
 * the agent's replies that name a local file, and the files it made in a turn.
 */
import { messageStore } from '../stores/messages.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';

/**
 * The local file a link or image source in a reply names (a path, absolute
 * or relative to the worktree, or a file:// URL), else null for a web address
 * or an in-page link. Percent-escapes are decoded, as marked encodes the
 * links it writes; a file:// URL is left as it is for main to read.
 */
export function localFilePath(href: string | null | undefined): string | null {
  const h = href?.trim();
  if (!h || h.startsWith('#') || h.startsWith('?') || h.startsWith('//')) return null;
  if (/^file:/i.test(h)) return h;
  // A scheme (http:, mailto:, data:), but not a Windows drive letter (C:\).
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[a-z]:[\\/]/i.test(h)) return null;
  try {
    return decodeURI(h);
  } catch {
    return h;
  }
}

/** Open a file in the thread's worktree: a web page in the Preview tab,
 *  anything else as main decides (worktree-files.ts). False when it's gone. */
export async function openWorktreeFile(sessionId: string, filePath: string): Promise<boolean> {
  const result = await window.groveBench.openWorktreeFile(sessionId, filePath);
  if (result.kind === 'preview') {
    previewStore.setMode(sessionId, 'user');
    messageStore.setActiveTab(sessionId, 'preview');
    await previewStore.navigate(sessionId, 'user', result.url).catch((err) => console.warn(`Could not preview ${filePath}:`, err));
  }
  return result.kind !== 'missing';
}
