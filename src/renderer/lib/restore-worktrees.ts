import { store } from '../stores/sessions.svelte.js';

/**
 * Restore worktree sessions from disk on app startup.
 *
 * IMPORTANT: repos must NEVER be removed when an IPC call throws.
 * Only explicitly-invalid repos (validateRepo returns false) may be removed.
 */
export async function restoreWorktrees() {
  const runningSessions = await window.groveBench.listSessions();
  const runningMap = new Map(runningSessions.filter((s) => s.status === 'running').map((s) => [s.id, s]));

  for (const repo of [...store.repos]) {
    try {
      const valid = await window.groveBench.validateRepo(repo);
      if (!valid) {
        store.removeRepo(repo);
        continue;
      }
      const worktrees = await window.groveBench.listWorktrees(repo);
      for (const wt of worktrees) {
        if (store.sessions.find((s) => s.id === wt.id)) continue;

        const runningSession = runningMap.get(wt.id);
        const isRunning = !!runningSession;
        store.addSession({
          id: wt.id,
          branch: wt.branch,
          repoPath: repo,
          status: isRunning ? 'running' : 'stopped',
          direct: wt.direct,
          displayName: runningSession?.displayName ?? null,
        }, false);

        if (isRunning) {
          window.groveBench.resumeSession(wt.id, repo).catch((e: any) => {
            store.setError(e.message || String(e));
          });
        }
      }
    } catch (e) {
      console.error(`Failed to restore worktrees for ${repo}:`, e);
    }
  }
}
