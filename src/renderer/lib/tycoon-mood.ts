import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

export type Mood = 'error' | 'setup' | 'waiting' | 'working' | 'done' | 'idle';

/** Mutually exclusive session status, in the same priority order as the
 *  sidebar rows. Reads reactive stores — call from within $derived/$effect. */
export function sessionMood(session: { id: string; status: string }): Mood {
  if (session.status === 'error') return 'error';
  if (session.status === 'starting' || session.status === 'installing') return 'setup';
  if (messageStore.hasPendingPermission(session.id)) return 'waiting';
  if (messageStore.getIsRunning(session.id)) return 'working';
  if (store.needsAttention[session.id]) return 'done';
  return 'idle';
}

export function moodLabel(mood: Mood): string {
  switch (mood) {
    case 'error': return 'Error — needs attention';
    case 'setup': return 'Setting up workspace…';
    case 'waiting': return 'Waiting for permission';
    case 'working': return 'Working…';
    case 'done': return 'Finished — ready for review';
    case 'idle': return 'Idle';
  }
}
