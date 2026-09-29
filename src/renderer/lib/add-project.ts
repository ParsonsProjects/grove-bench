import { store } from '../stores/sessions.svelte.js';
import { stripIpcErrorPrefix } from './mcp-errors.js';

/** Ask for a folder and add it as a project. Cancelling does nothing; a
 *  folder that can't be a project shows why. */
export async function addProject(): Promise<void> {
  try {
    const selected = await window.groveBench.addRepo();
    if (selected) {
      store.addRepo(selected);
      store.clearError();
    }
  } catch (e) {
    store.setError(stripIpcErrorPrefix(e instanceof Error ? e.message : String(e)));
  }
}
