import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { getRepoColor } from './repo-colors.js';

/**
 * A conversation's project colour, or null when there is none to show (one
 * project and no custom colour, or an unknown conversation).
 */
export function sessionRepoColor(sessionId: string): string | null {
  const session = store.sessions.find((s) => s.id === sessionId);
  return session ? getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors) : null;
}
