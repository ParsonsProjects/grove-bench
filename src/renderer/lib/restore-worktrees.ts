import { store } from '../stores/sessions.svelte.js';

/**
 * Restore worktree sessions from disk on app startup.
 *
 * IMPORTANT: repos must NEVER be removed during restore. The user explicitly
 * added them — if validation fails (e.g. git not in PATH yet), just skip
 * restoring sessions for that repo. The repo stays in the sidebar so the
 * user can retry or remove it manually.
 *
 * Repos are restored in parallel: each one costs a couple of git subprocess
 * calls, and running them serially made startup scale with repo count.
 */
export async function restoreWorktrees() {
  const runningSessions = await window.groveBench.listSessions();
  const runningMap = new Map(runningSessions.filter((s) => s.status === 'running').map((s) => [s.id, s]));

  await Promise.all([...store.repos].map(async (repo) => {
    try {
      const valid = await window.groveBench.validateRepo(repo);
      if (!valid) {
        console.warn(`Repo validation failed during restore, skipping: ${repo}`);
        return;
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
          // Only a running session knows its adapter; stopped ones fall back
          // to the default adapter in the UI until they are restarted.
          agentType: runningSession?.agentType,
          // Prefer the running session's name; fall back to the persisted manifest
          // name so stopped sessions also restore their label after restart.
          displayName: runningSession?.displayName ?? wt.displayName ?? null,
          createdAt: wt.createdAt,
          lastActiveAt: wt.lastActiveAt,
          completedAt: wt.completedAt ?? null,
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
  }));
}
