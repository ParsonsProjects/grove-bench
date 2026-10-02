import { store } from '../stores/sessions.svelte.js';
import { stripIpcErrorPrefix } from './mcp-errors.js';

/** Ask for a folder and add it as a project. Cancelling does nothing; a
 *  folder that can't be a project shows why. A folder that isn't a git
 *  repository is added as a plain folder. */
export async function addProject(): Promise<void> {
  try {
    const picked = await window.groveBench.addRepo();
    if (!picked) return;
    store.clearError();
    store.addRepo(picked.path, { folder: picked.kind === 'folder' });
  } catch (e) {
    store.setError(stripIpcErrorPrefix(e instanceof Error ? e.message : String(e)));
  }
}
