import type { ConversationGoal } from '../../shared/types.js';
import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';

const NO_GOAL: ConversationGoal = { text: null, source: null, hidden: false };

/** `record` without `key`. Reassigned rather than deleted: a $state proxy
 *  still answers `in` for a deleted key that was in the assigned object. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record;
  return rest;
}

/** How long an automatic goal runs before the bar says one is being written.
 *  Main answers at once when it skips (one exists, no reply yet, gave up),
 *  and those answers shouldn't flash the busy state. */
const AUTO_BUSY_DELAY_MS = 400;

/**
 * Each conversation's goal: the line pinned at the top of its Thread tab.
 * Main keeps it in the conversation's manifest entry; this holds what the
 * renderer has loaded, and which goals are being generated.
 */
class GoalStore {
  goals = $state<Record<string, ConversationGoal>>({});
  generating = $state<Record<string, boolean>>({});
  /** Why the last Refresh failed, until the next action on the goal. */
  errors = $state<Record<string, string>>({});
  private loading = new Set<string>();
  private autoInFlight = new Set<string>();

  get(sessionId: string): ConversationGoal {
    return this.goals[sessionId] ?? NO_GOAL;
  }

  isLoaded(sessionId: string): boolean {
    return sessionId in this.goals;
  }

  isGenerating(sessionId: string): boolean {
    return !!this.generating[sessionId];
  }

  error(sessionId: string): string | null {
    return this.errors[sessionId] ?? null;
  }

  clearError(sessionId: string): void {
    if (this.errors[sessionId] !== undefined) this.errors = without(this.errors, sessionId);
  }

  private set(sessionId: string, goal: ConversationGoal | null | undefined): void {
    if (goal) this.goals[sessionId] = goal;
  }

  /** Read the goal from main. Null means main has no entry for the
   *  conversation yet (a new worktree is still being set up), which is no
   *  goal so far. A failed read is tried again on the next call. */
  async load(sessionId: string): Promise<void> {
    if (this.isLoaded(sessionId) || this.loading.has(sessionId)) return;
    this.loading.add(sessionId);
    try {
      const goal = await window.groveBench.getConversationGoal(sessionId);
      if (!this.isLoaded(sessionId)) this.goals[sessionId] = goal ?? NO_GOAL;
    } catch { /* not loaded: the next call tries again */ } finally {
      this.loading.delete(sessionId);
    }
  }

  /** After a turn ends: make the conversation's first goal, if it has never
   *  had one. Main decides; this only skips the call when the answer is known. */
  async autoGenerate(sessionId: string): Promise<void> {
    const known = this.goals[sessionId];
    if (known?.source || known?.hidden || this.autoInFlight.has(sessionId) || this.generating[sessionId]) return;
    this.autoInFlight.add(sessionId);
    const busy = setTimeout(() => { this.generating[sessionId] = true; }, AUTO_BUSY_DELAY_MS);
    try {
      this.set(sessionId, await window.groveBench.autoConversationGoal(sessionId));
    } catch { /* best-effort: Refresh can still make one */ } finally {
      clearTimeout(busy);
      this.autoInFlight.delete(sessionId);
      if (this.generating[sessionId]) this.generating[sessionId] = false;
    }
  }

  /** Make a new goal now, replacing the current one. */
  async refresh(sessionId: string): Promise<void> {
    if (this.generating[sessionId]) return;
    this.clearError(sessionId);
    this.generating[sessionId] = true;
    try {
      this.set(sessionId, await window.groveBench.refreshConversationGoal(sessionId));
    } catch (e) {
      const message = stripIpcErrorPrefix(e instanceof Error ? e.message : String(e ?? ''));
      this.errors[sessionId] = message || 'Could not write a goal';
    } finally {
      this.generating[sessionId] = false;
    }
  }

  /** Save a goal the user typed. Empty text clears it. */
  async save(sessionId: string, text: string): Promise<void> {
    this.clearError(sessionId);
    this.goals[sessionId] = { ...this.get(sessionId), text: text.trim() || null, source: 'user' };
    try {
      this.set(sessionId, await window.groveBench.setConversationGoal(sessionId, text));
    } catch { /* kept here; it is saved again on the next edit */ }
  }

  /** Close or reopen the goal bar for one conversation. */
  async setHidden(sessionId: string, hidden: boolean): Promise<void> {
    this.goals[sessionId] = { ...this.get(sessionId), hidden };
    try {
      this.set(sessionId, await window.groveBench.setConversationGoalHidden(sessionId, hidden));
    } catch { /* kept here for this run */ }
  }

  /** Drop everything kept for a deleted conversation. */
  forget(sessionId: string): void {
    this.goals = without(this.goals, sessionId);
    this.generating = without(this.generating, sessionId);
    this.errors = without(this.errors, sessionId);
  }
}

export const goalStore = new GoalStore();
