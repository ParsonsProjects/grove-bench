import type { ConversationGoal } from '../../shared/types.js';
import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';

const NO_GOAL: ConversationGoal = { text: null, source: null, hidden: false };

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
    delete this.errors[sessionId];
  }

  private set(sessionId: string, goal: ConversationGoal | null | undefined): void {
    if (goal) this.goals[sessionId] = goal;
  }

  async load(sessionId: string): Promise<void> {
    if (this.isLoaded(sessionId) || this.loading.has(sessionId)) return;
    this.loading.add(sessionId);
    try {
      this.set(sessionId, await window.groveBench.getConversationGoal(sessionId));
    } catch { /* best-effort: the bar stays empty */ } finally {
      this.loading.delete(sessionId);
    }
  }

  /** After a turn ends: make the conversation's first goal, if it has never
   *  had one. Main decides; this only skips the call when the answer is known. */
  async autoGenerate(sessionId: string): Promise<void> {
    if (this.goals[sessionId]?.source || this.generating[sessionId]) return;
    this.generating[sessionId] = true;
    try {
      this.set(sessionId, await window.groveBench.autoConversationGoal(sessionId));
    } catch { /* best-effort: Refresh can still make one */ } finally {
      this.generating[sessionId] = false;
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
}

export const goalStore = new GoalStore();
