import type { LinkedProjectStatus } from '../../shared/types.js';
import { store } from './sessions.svelte.js';

/** How often a watched thread's linked projects are read again, as PR
 *  status is (pr.svelte.ts). */
const POLL_MS = 60_000;

/**
 * The state of each thread's linked projects (git:linkedStatus,
 * docs/linked-projects-plan.md): what the status bar's linked items show.
 * Read when the bar shows the thread, then every minute, at the end of each
 * turn and when the window comes back into focus.
 */
class LinkedStore {
  private bySession = $state<Record<string, LinkedProjectStatus[]>>({});
  /** Reads under way, so a burst of triggers runs one. */
  private inFlight = new Map<string, Promise<void>>();

  get(sessionId: string): LinkedProjectStatus[] {
    return this.bySession[sessionId] ?? [];
  }

  /** Read the thread's linked projects again, PRs and all. A read that
   *  fails keeps what was shown. */
  refresh(sessionId: string): Promise<void> {
    const running = this.inFlight.get(sessionId);
    if (running) return running;
    const read = (async () => {
      try {
        this.bySession[sessionId] = await window.groveBench.getLinkedStatus(sessionId, { pr: true });
      } catch {
        // Kept: the next poll tries again.
      } finally {
        this.inFlight.delete(sessionId);
      }
    })();
    this.inFlight.set(sessionId, read);
    return read;
  }

  /** Keep a thread's linked projects read while something shows them.
   *  Returns the stop, for an $effect. */
  watch(sessionId: string): () => void {
    void this.refresh(sessionId);
    const timer = setInterval(() => void this.refresh(sessionId), POLL_MS);
    const onFocus = () => void this.refresh(sessionId);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }

  /** Drop a deleted thread's state. */
  forget(sessionId: string): void {
    delete this.bySession[sessionId];
    if (this.linkDialogFor === sessionId) this.linkDialogFor = null;
  }

  // ── Linking and unlinking part way through ──

  /** The thread the Work in Another Project dialog is open for
   *  (LinkProjectDialog, mounted in App). */
  linkDialogFor = $state<string | null>(null);

  openLinkDialog(sessionId: string): void {
    this.linkDialogFor = sessionId;
  }

  /** The git projects a thread could also work in: not its own, and not
   *  one it works in already. */
  linkableFor(sessionId: string): string[] {
    const thread = store.sessions.find((s) => s.id === sessionId);
    if (!thread) return [];
    const linked = new Set(thread.linkedRepos ?? []);
    return store.repos.filter((r) => r !== thread.repoPath && !linked.has(r) && !store.isFolderProject(r));
  }

  /** Whether Work in Another Project is offered for a thread: one with a
   *  live agent to tell (main refuses the rest too), in its own worktree,
   *  with a git project left to link. */
  canLink(sessionId: string): boolean {
    const thread = store.sessions.find((s) => s.id === sessionId);
    if (!thread || thread.status === 'stopped' || thread.status === 'error') return false;
    return !thread.direct && !thread.noGit && this.linkableFor(sessionId).length > 0;
  }

  /** Have the thread also work in `repoPath` (main makes the worktree and
   *  restarts the agent). Returns main's warning, if any; throws its
   *  refusal. */
  async link(sessionId: string, repoPath: string): Promise<string | undefined> {
    const { warning } = await window.groveBench.linkProject(sessionId, repoPath);
    const thread = store.sessions.find((s) => s.id === sessionId);
    store.setLinkedRepos(sessionId, [...(thread?.linkedRepos ?? []).filter((r) => r !== repoPath), repoPath]);
    void this.refresh(sessionId);
    return warning;
  }

  /** Stop the thread working in `repoPath`: its worktree goes. Throws
   *  main's refusal, keeping the link. */
  async unlink(sessionId: string, repoPath: string, deleteBranch: boolean): Promise<void> {
    await window.groveBench.unlinkProject(sessionId, repoPath, deleteBranch);
    const thread = store.sessions.find((s) => s.id === sessionId);
    store.setLinkedRepos(sessionId, (thread?.linkedRepos ?? []).filter((r) => r !== repoPath));
    this.bySession[sessionId] = this.get(sessionId).filter((l) => l.repoPath !== repoPath);
    void this.refresh(sessionId);
  }
}

export const linkedStore = new LinkedStore();
