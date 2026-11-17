import { store } from '../stores/sessions.svelte.js';
import { errorMessage } from '../../shared/error-message.js';
import { ipcErrorText } from './mcp-errors.js';
import type { SessionInfo } from '../../shared/types.js';

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
 *
 * Returns the ids of the sessions it added. The UI is usable while this runs,
 * so the store can also hold threads the user started meanwhile.
 */
export async function restoreWorktrees(): Promise<Set<string>> {
  const restored = new Set<string>();
  const running = runningById(await window.groveBench.listSessions());
  await Promise.all([...store.repos].map((repo) => restoreProject(repo, running, restored)));
  return restored;
}

/** List a project's threads again, after its folder came back or git could
 *  read it (the sidebar's Try again). */
export async function retryProject(repo: string): Promise<void> {
  store.setProjectLoad(repo, { state: 'loading' });
  try {
    const restored = new Set<string>();
    await restoreProject(repo, runningById(await window.groveBench.listSessions()), restored);
    // As at startup: its threads that were open come back in Threads,
    // waiting to reconnect until opened.
    const open = new Set(await window.groveBench.getOpenTabs());
    for (const id of restored) {
      const session = store.sessions.find((s) => s.id === id);
      if (open.has(id) && session?.status === 'stopped') store.deferResume(id);
    }
  } catch (e) {
    store.setProjectLoad(repo, { state: 'failed', error: ipcErrorText(e) });
  }
}

/** Sessions main still holds: running, or asleep (open, agent shut down).
 *  Starting counts as running: a resumed agent reports in only with its
 *  first prompt, and one shown stopped would keep running out of sight,
 *  where idle sleep never reaches it. */
function runningById(sessions: SessionInfo[]): Map<string, SessionInfo> {
  return new Map(sessions
    .filter((s) => s.status === 'running' || s.status === 'starting' || s.status === 'sleeping')
    .map((s) => [s.id, s]));
}

/** Add one project's threads to the store, and note how that went in
 *  projectLoad: a project whose folder is gone, or whose threads git
 *  couldn't list, says so in the sidebar rather than show none. */
async function restoreProject(repo: string, runningMap: Map<string, SessionInfo>, restored: Set<string>): Promise<void> {
  try {
    // A folder project (not a git repository) restores like any other;
    // only a project whose folder is gone is skipped.
    const kind = await window.groveBench.repoKind(repo);
    if (kind === 'missing') {
      console.warn(`Project folder not found during restore, skipping: ${repo}`);
      store.setProjectLoad(repo, { state: 'missing' });
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
      }, false);
      restored.add(wt.id);

      if (isRunning) {
        window.groveBench.resumeSession(wt.id, repo).catch((e: unknown) => {
          store.setError(errorMessage(e));
        });
      }
    }
    store.setProjectLoad(repo, null);
  } catch (e) {
    console.error(`Failed to restore worktrees for ${repo}:`, e);
    store.setProjectLoad(repo, { state: 'failed', error: ipcErrorText(e) });
  }
}
