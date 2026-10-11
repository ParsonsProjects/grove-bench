import type { AgentEvent } from '../../shared/types.js';

/**
 * Turns a running cost total back into each turn's cost.
 *
 * Claude Code reports `total_cost_usd` on every result as the running total
 * for the whole query(), not the turn's own cost; a resumed or forked
 * conversation starts from the total its transcript saved, and /clear starts
 * it again (see `total_cost_usd` in @anthropic-ai/claude-agent-sdk's
 * sdk.d.ts). Grove's result event carries the turn's cost, so the adapter
 * keeps one of these per query.
 */
export class RunningCost {
  private last: number;
  private first = true;

  /** `resumedFrom`: the total the conversation had reached before this
   *  query resumed it, or null for a new conversation (or unknown). */
  constructor(private readonly resumedFrom: number | null = null) {
    this.last = resumedFrom ?? 0;
  }

  /** The cost of the turn a result with running total `total` ends. */
  turnCost(total: number, isError: boolean): number {
    const first = this.first;
    this.first = false;
    if (total >= this.last) {
      const turn = total - this.last;
      this.last = total;
      return turn;
    }
    // A failed start or crash can report a zeroed total; the real one
    // carries on with the next result.
    if (isError) return 0;
    // A resumed query whose first total is below where the conversation
    // was: its transcript kept a smaller total, or none. How much of it is
    // this turn can't be told, so count nothing rather than charge the
    // earlier turns again.
    if (first && this.resumedFrom !== null) {
      this.last = total;
      return 0;
    }
    // /clear: the total started again from 0.
    this.last = total;
    return total;
  }
}

/** The running total the conversation last reached, from its history, for
 *  a query that resumes it: the last result's sessionCostUsd, or before
 *  results carried that, its totalCostUsd (Claude Code's running total was
 *  passed on as it was). Null with no cost reported since the agent's
 *  conversation began (an agent switch or a new conversation starts one). */
export function lastRunningCost(history: readonly AgentEvent[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.type === 'agent_changed') return null;
    if (e.type === 'status' && e.newConversation) return null;
    if (e.type === 'result' && (e.sessionCostUsd !== undefined || e.totalCostUsd !== undefined)) {
      return e.sessionCostUsd ?? e.totalCostUsd ?? null;
    }
  }
  return null;
}
