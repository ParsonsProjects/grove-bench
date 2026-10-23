/**
 * The status bar's Files list (shared/thread-items.ts): what each file is
 * called, where its image loads from, an attached text file's text and how
 * it shows (from here and its chip in the thread), and the jump to the
 * message a task list or file came with.
 */
import { messageStore } from '../stores/messages.svelte.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { attachmentImageUrl, isMarkdownFile, worktreeFileUrl } from '../../shared/attachments.js';
import { attachedFilesFromSent } from '../../shared/prompt-text.js';
import { toolLabel } from './tool-names.js';
import type { ThreadFile } from '../../shared/thread-items.js';

/** Show the message an event made in the Thread tab, as a search hit does. */
export function showInThread(sessionId: string, eventIndex: number): void {
  messageStore.setActiveTab(sessionId, 'activity');
  messageStore.requestJump(sessionId, { eventIndex, uuid: null, bookmarkId: '' });
}

/** The name a file goes by in the list. */
export function threadFileName(f: ThreadFile): string {
  switch (f.kind) {
    case 'image':
      if (f.from === 'user') return f.image.name || 'Image';
      return f.toolName ? `Image from ${toolLabel(f.toolName)}` : 'Image from a tool';
    case 'text':
      return f.name;
    case 'file':
      return f.file.name;
    case 'made':
      return f.made.path;
  }
}

/** Its size in bytes, where the thread knows it. */
export function threadFileSize(f: ThreadFile): number | undefined {
  switch (f.kind) {
    case 'text': return f.size;
    case 'file': return f.file.size;
    case 'made': return f.made.size;
    default: return undefined;
  }
}

/** Where an image in the list loads from (the saved copy, else the file in
 *  the worktree), or null for a file that isn't an image. */
export function threadImageSrc(sessionId: string, f: ThreadFile): string | null {
  if (f.kind === 'image') return attachmentImageUrl(sessionId, f.image.file);
  if (f.kind === 'made' && f.made.kind === 'image') {
    return f.made.image ? attachmentImageUrl(sessionId, f.made.image.file) : worktreeFileUrl(sessionId, f.made.path);
  }
  return null;
}

/** Show an attached text file in the Focus panel: Markdown as it reads,
 *  anything else as numbered lines. */
export function showAttachedText(sessionId: string, name: string, content: string): void {
  if (isMarkdownFile(name)) markdownPreviewStore.show(content, name, sessionId);
  else markdownPreviewStore.showCode(content, name, sessionId);
}

/** The content of a text file attached to the message at `eventIndex`, or
 *  null when that message is gone (a rewind or /clear took it). */
export async function attachedTextContent(sessionId: string, eventIndex: number, name: string): Promise<string | null> {
  const page = await window.groveBench.getEventHistoryPage(sessionId, 1, eventIndex + 1);
  const event = page.startIndex === eventIndex ? page.events[0] : undefined;
  if (event?.type !== 'user_message') return null;
  return attachedFilesFromSent(event.text).files.findLast((f) => f.path === name)?.content ?? null;
}
