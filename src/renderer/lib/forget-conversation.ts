/**
 * Drop everything the renderer keeps for a conversation that was deleted.
 * One list, so a store that holds per-conversation state can't be left out
 * of the delete path (and grow with every conversation deleted).
 */
import { store } from '../stores/sessions.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { checkpointStore } from '../stores/checkpoints.svelte.js';
import { terminalStore } from '../stores/terminal.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';
import { sessionPreviewStore } from '../stores/sessionPreviews.svelte.js';
import { prStore } from '../stores/pr.svelte.js';
import { reviewStore } from '../stores/review.svelte.js';
import { groupStore } from '../stores/groups.svelte.js';

export function forgetConversation(id: string): void {
  store.removeSession(id);
  gitStatusStore.clear(id);
  messageStore.destroySession(id);
  checkpointStore.clear(id);
  terminalStore.destroySession(id);
  previewStore.forget(id);
  bookmarkStore.dropSessionLocal(id);
  sessionPreviewStore.invalidate(id);
  prStore.clear(id);
  reviewStore.clear(id); // also drops its localStorage entry
  groupStore.remove(id); // a group it leaves empty goes too
}
