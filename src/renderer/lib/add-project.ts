import { store } from '../stores/sessions.svelte.js';

/** Ask for a folder and add it as a project. Cancelling does nothing; a
 *  folder that isn't a git repository rejects, like any IPC failure. */
export async function addProject(): Promise<void> {
  const selected = await window.groveBench.addRepo();
  if (selected) {
    store.addRepo(selected);
    store.clearError();
  }
}
