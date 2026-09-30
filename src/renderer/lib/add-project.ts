import { store } from '../stores/sessions.svelte.js';
import { stripIpcErrorPrefix } from './mcp-errors.js';

/** Ask for a folder and add it as a project. Cancelling does nothing; a
 *  folder that can't be a project shows why. A folder that isn't a git
 *  repository opens FolderProjectDialog: set git up there, or use it as it is. */
export async function addProject(): Promise<void> {
  try {
    const picked = await window.groveBench.addRepo();
    if (!picked) return;
    store.clearError();
    if (picked.kind === 'git') store.addRepo(picked.path, { folder: false });
    else store.pendingFolder = { path: picked.path, gitAvailable: picked.gitAvailable };
  } catch (e) {
    store.setError(stripIpcErrorPrefix(e instanceof Error ? e.message : String(e)));
  }
}
