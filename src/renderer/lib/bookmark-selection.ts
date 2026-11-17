import { messageStore } from '../stores/messages.svelte.js';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { BookmarkLink } from '../../shared/types.js';

/** Bookmark selected text, linked to the Activity row it came from when there
 *  is one (`msgId`); without one it is a text-only bookmark. `links`: the
 *  links in the selection (selection-links), which `text` leaves out. */
export async function bookmarkSelection(
  sessionId: string,
  text: string,
  msgId: string | null,
  links: readonly BookmarkLink[],
): Promise<void> {
  let messageUuid: string | null = null;
  let eventIndex: number | null = null;
  if (msgId) {
    const msg = messageStore.getMessages(sessionId).find((m) => m.id === msgId);
    const uuid = (msg && 'uuid' in msg ? (msg as { uuid?: string }).uuid : '') || '';
    messageUuid = uuid || null;
    eventIndex = messageStore.getEventIndexForMessageId(sessionId, msgId);
    if (eventIndex == null && uuid) {
      eventIndex = await window.groveBench.findEventIndexByUuid(sessionId, uuid);
    }
  }
  const session = store.sessions.find((s) => s.id === sessionId);
  await bookmarkStore.add({
    sessionId,
    repoPath: session?.repoPath ?? '',
    sessionLabel: session?.displayName || session?.branch || sessionId,
    messageUuid,
    eventIndex,
    selectedText: text,
    // Just what's saved (a FoundLink also says how the selection shows it).
    links: links.map(({ kind, href, text: linkText }) => ({ kind, href, text: linkText })),
  });
}
