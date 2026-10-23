import { store } from './sessions.svelte.js';
import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
import type { PrerequisiteStatus } from '../../shared/types.js';

function errorMessage(err: unknown): string {
  return stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
}

/**
 * Git and agent checks, run in the background. Nothing here blocks the app:
 * the last known result shows at launch and a fresh check replaces it when it
 * lands. Git gates only git-backed features; agent credentials are asked for
 * when the user starts a conversation. Results go in `store.prerequisites`,
 * which the sidebar and status bar already read.
 */
class PrerequisitesStore {
  /** A git + agent check is running. */
  checking = $state(false);

  private inFlight: Promise<void> | null = null;

  /** Show the last known result straight away, then re-check. */
  async init(): Promise<void> {
    try {
      const cached = await window.groveBench.getCachedPrerequisites();
      if (cached && !store.prerequisites) store.prerequisites = cached;
    } catch { /* no cache: the check below fills it */ }
    await this.refresh();
    this.refreshGh();
  }

  /** Re-run the git + agent check. Concurrent calls share one run. */
  refresh(): Promise<void> {
    this.inFlight ??= this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Save an API key for one agent. Throws a user-facing message. */
  async saveApiKey(adapterId: string, key: string): Promise<void> {
    try {
      this.apply(await window.groveBench.setApiKey(adapterId, key));
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  /** Start the agent briefly to find out whether it is signed in. */
  async checkSignIn(adapterId: string): Promise<void> {
    this.checking = true;
    try {
      this.apply(await window.groveBench.checkAgentSignIn(adapterId));
    } catch (err) {
      throw new Error(errorMessage(err));
    } finally {
      this.checking = false;
    }
  }

  async clearApiKey(adapterId: string): Promise<void> {
    try {
      this.apply(await window.groveBench.clearApiKey(adapterId));
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  private async run(): Promise<void> {
    this.checking = true;
    try {
      this.apply(await window.groveBench.checkPrerequisites());
    } catch (err) {
      // Keep the last known result. Callers show a Re-check button.
      console.error('Prerequisite check failed:', err);
    } finally {
      this.checking = false;
    }
  }

  /** The core check doesn't run gh, so keep the gh status we already have. */
  private apply(status: PrerequisiteStatus): void {
    store.prerequisites = { ...status, gh: status.gh ?? store.prerequisites?.gh };
  }

  /** The GitHub CLI check can hit the network and only enables PR features,
   *  so it runs once, after the core check. */
  private refreshGh(): void {
    window.groveBench.checkGhPrerequisite().then((gh) => {
      if (store.prerequisites) store.prerequisites = { ...store.prerequisites, gh };
    }).catch(() => { /* PR features simply stay disabled */ });
  }
}

export const prerequisitesStore = new PrerequisitesStore();
