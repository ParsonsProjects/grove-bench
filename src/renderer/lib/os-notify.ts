import type { OsNotificationRequest } from '../../shared/types.js';
import { store as sessionStore } from '../stores/sessions.svelte.js';

/** Human-readable label for a session: display name, else branch, else id. */
export function sessionLabel(sessionId: string): string {
  const session = sessionStore.sessions.find((s) => s.id === sessionId);
  return session?.displayName || session?.branch || sessionId;
}

/** Fire-and-forget desktop notification request. Main gates on window focus
 *  and settings, so callers don't need any conditions of their own. */
export function notifyOs(kind: OsNotificationRequest['kind'], sessionId: string, body: string): void {
  try {
    window.groveBench.notify({ kind, sessionId, title: sessionLabel(sessionId), body });
  } catch { /* notifications are best-effort */ }
}
