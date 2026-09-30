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
  // Sessions main still holds: running, or asleep (open, agent shut down).
  const runningMap = new Map(runningSessions
    .filter((s) => s.status === 'running' || s.status === 'sleeping')
    .map((s) => [s.id, s]));

  await Promise.all([...store.repos].map(async (repo) => {
    try {
      // A folder project (not a git repository) restores like any other;
      // only a project whose folder is gone is skipped.
      const kind = await window.groveBench.repoKind(repo);
      if (kind === 'missing') {
        console.warn(`Project folder not found during restore, skipping: ${repo}`);
        return;
      }
      store.setFolderProject(repo, kind === 'folder');
      const worktrees = await window.groveBench.listWorktrees(repo);
      for (const wt of worktrees) {
        if (store.sessions.find((s) => s.id === wt.id)) continue;

        const runningSession = runningMap.get(wt.id);
        const isRunning = !!runningSession;
        store.addSession({
          id: wt.id,
          branch: wt.branch,
          repoPath: repo,
          status: runningSession?.status === 'sleeping' ? 'sleeping' : isRunning ? 'running' : 'stopped',
          direct: wt.direct,
          ...(wt.noGit ? { noGit: true } : {}),
          // The manifest records each conversation's agent, so stopped ones
          // show the right agent too.
          agentType: runningSession?.agentType ?? wt.agentType,
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
