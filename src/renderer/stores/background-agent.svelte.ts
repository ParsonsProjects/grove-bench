import { agentsStore } from './agents.svelte.js';
import { store } from './sessions.svelte.js';

/** An open question: which agent should run `task` for a thread whose own
 *  agent (`agentId`) is gone. */
export interface BackgroundAgentAsk {
  sessionId: string;
  agentId: string;
  /** What will run, e.g. "write a commit message". */
  task: string;
  resolve: (choice: string | null) => void;
}

/**
 * Background tasks the user starts on a thread (a commit message, a new
 * goal) run on the thread's own agent, so its content only goes to the
 * provider chosen for it. When that agent is gone (a custom agent taken out
 * of Settings, a removed Claude account, after a restart), this asks which
 * agent to use instead, rather than sending it anywhere unasked. The answer
 * is kept for the thread until Grove Bench restarts.
 */
class BackgroundAgentStore {
  /** Shown by BackgroundAgentDialog while set. */
  ask = $state<BackgroundAgentAsk | null>(null);
  private picked = new Map<string, string>();

  /** The agent to run `task` on instead of the thread's own: undefined when
   *  its own agent is there to do it, an agent id the user picked, or null
   *  when they cancelled. */
  async substituteFor(sessionId: string, task: string): Promise<string | null | undefined> {
    await agentsStore.load();
    const agentId = store.sessions.find((s) => s.id === sessionId)?.agentType;
    if (!agentsStore.loaded || !agentId || agentsStore.get(agentId)) return undefined;
    const remembered = this.picked.get(sessionId);
    if (remembered && agentsStore.get(remembered)) return remembered;
    const choice = await new Promise<string | null>((resolve) => {
      // One question at a time: an earlier one still open is cancelled.
      this.ask?.resolve(null);
      this.ask = { sessionId, agentId, task, resolve };
    });
    if (choice) this.picked.set(sessionId, choice);
    return choice;
  }

  /** The user's answer to the open question: an agent id, or null to cancel. */
  answer(choice: string | null): void {
    const ask = this.ask;
    this.ask = null;
    ask?.resolve(choice);
  }

  /** Test hook: forget the answers given this run. */
  reset(): void {
    this.answer(null);
    this.picked.clear();
  }
}

export const backgroundAgentStore = new BackgroundAgentStore();
