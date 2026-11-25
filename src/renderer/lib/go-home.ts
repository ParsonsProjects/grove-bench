import { store } from '../stores/sessions.svelte.js';
import { boardStore } from '../stores/board.svelte.js';
import { draftStore } from '../stores/draft.svelte.js';

/**
 * The title bar logo and Ctrl+G: back to the landing, where no thread is
 * open (Pick a thread, or the grove map with its setting on). Threads keep
 * running and stay open in the sidebar; the board closes, and a draft being
 * written is set aside, not lost (its sidebar row brings it back).
 */
export function goHome(): void {
  store.activeSessionId = null;
  boardStore.close();
  if (draftStore.draft) draftStore.aside = true;
}
