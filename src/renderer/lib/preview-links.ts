/**
 * Where a link clicked in a conversation opens: local pages (localhost,
 * 127.0.0.1, [::1]) go to that conversation's Preview tab; other links, and
 * any link Ctrl/Cmd+clicked, go to the system browser.
 */
import { isLocalHttpUrl, toBrowsableUrl } from '../../shared/preview-url.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';

/** Whether a link goes to a Preview tab when there is a thread to open it
 *  in: a local page, not Ctrl/Cmd+clicked. */
export function isPreviewLink(url: string, event?: { ctrlKey?: boolean; metaKey?: boolean } | null): boolean {
  return !(event?.ctrlKey || event?.metaKey) && isLocalHttpUrl(toBrowsableUrl(url));
}

export function opensInPreview(url: string, event?: { ctrlKey?: boolean; metaKey?: boolean } | null): boolean {
  return !!store.activeSessionId && isPreviewLink(url, event);
}

export function openLink(url: string, event?: { ctrlKey?: boolean; metaKey?: boolean } | null): void {
  const target = toBrowsableUrl(url);
  const sessionId = store.activeSessionId;
  if (sessionId && opensInPreview(target, event)) {
    previewStore.setMode(sessionId, 'user');
    messageStore.setActiveTab(sessionId, 'preview');
    // The worktree may not be ready yet; the system browser still works.
    previewStore.navigate(sessionId, 'user', target).catch(() => window.groveBench.openExternal(target));
    return;
  }
  void window.groveBench.openExternal(target);
}
