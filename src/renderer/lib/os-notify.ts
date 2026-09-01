import type { OsNotificationRequest } from '../../shared/types.js';
import { store as sessionStore } from '../stores/sessions.svelte.js';

/** Human-readable label for a session: display name, else branch, else id. */
export function sessionLabel(sessionId: string): string {
  const session = sessionStore.sessions.find((s) => s.id === sessionId);
  return session?.displayName || session?.branch || sessionId;
}

/** Fire-and-forget desktop notification request. Main gates on window focus
 *  and settings; this gates on the session still being open — a stopped or
 *  removed session has nothing actionable behind the toast. */
export function notifyOs(kind: OsNotificationRequest['kind'], sessionId: string, body: string): void {
  const session = sessionStore.sessions.find((s) => s.id === sessionId);
  if (!session || session.status === 'stopped') return;
  try {
    window.groveBench.notify({ kind, sessionId, title: session.displayName || session.branch || sessionId, body });
  } catch { /* notifications are best-effort */ }
}
