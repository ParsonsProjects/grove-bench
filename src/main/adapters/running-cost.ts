import type { AgentEvent, ModelTotals, ModelTurnUsage, TokenCounts } from '../../shared/types.js';

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

  /** The running total as far as it's known: a zeroed total from a failed
   *  start doesn't replace it. */
  get total(): number {
    return this.last;
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

/**
 * Turns Claude Code's running token totals (modelUsage, which shares
 * total_cost_usd's lifecycle) back into each turn's tokens, by the same
 * rules as RunningCost.
 */
export class RunningTokens {
  private readonly input: RunningCost;
  private readonly output: RunningCost;

  constructor(resumedFrom: TokenCounts | null = null) {
    this.input = new RunningCost(resumedFrom?.input ?? null);
    this.output = new RunningCost(resumedFrom?.output ?? null);
  }

  /** The tokens of the turn a result with running totals `total` ends. */
  turnTokens(total: TokenCounts, isError: boolean): TokenCounts {
    return { input: this.input.turnCost(total.input, isError), output: this.output.turnCost(total.output, isError) };
  }

  /** The running totals as far as they're known (as RunningCost.total). */
  get total(): TokenCounts {
    return { input: this.input.total, output: this.output.total };
  }
}

/** The running token totals the conversation last reached, from its
 *  history, for a query that resumes it (as lastRunningCost). */
export function lastRunningTokens(history: readonly AgentEvent[]): TokenCounts | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.type === 'agent_changed') return null;
    if (e.type === 'status' && e.newConversation) return null;
    if (e.type === 'result' && e.sessionTokens) return e.sessionTokens;
  }
  return null;
}

/** One model's running totals in a result, as the agent reported them.
 *  `key`: the provider's name for it, the same across a query's results;
 *  `model`: the name to show it under. */
export interface RunningModel extends ModelTotals {
  key: string;
  model: string;
}

/** Split `total` in proportion to `weights` as whole numbers that add up
 *  to it: each share rounded down, the rest one each to the largest
 *  remainders. All zeros when the weights are. */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!(sum > 0) || !(total > 0)) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((a, s) => a + s, 0);
  const byRemainder = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    shares[i]++;
    left--;
  }
  return shares;
}

/** The first weights that aren't all zero, or the last set. */
function firstNonZero(...sets: number[][]): number[] {
  return sets.find((w) => w.some((x) => x > 0)) ?? sets[sets.length - 1];
}

/**
 * Splits each turn's tokens and cost by model, from Claude Code's running
 * per-model totals (modelUsage, which shares total_cost_usd's lifecycle).
 * The turn's own figures come from RunningTokens and RunningCost; this only
 * says how they divide, by how much each model's totals rose since the last
 * result, so the models always add up to the turn. Where nothing is known
 * to compare with (a conversation resumed from before models were saved)
 * the split follows the running totals instead.
 */
export class RunningModels {
  private readonly last: Map<string, ModelTotals>;

  /** `resumedFrom`: each model's totals the conversation had reached
   *  (lastRunningModels), or null for a new conversation (or unknown). */
  constructor(resumedFrom: Readonly<Record<string, ModelTotals>> | null = null) {
    this.last = new Map(Object.entries(resumedFrom ?? {}));
  }

  /** Each model's running totals as far as they're known, to resume from. */
  get totals(): Record<string, ModelTotals> {
    return Object.fromEntries([...this.last].map(([k, t]) => [k, { ...t }]));
  }

  /** The turn's tokens and cost (`turn`) by model, the thread's main model
   *  first: the one that has done the most in the conversation, which a
   *  turn's time goes to, so a subagent that read more this turn doesn't
   *  take it. Empty when the result names no models. */
  turnModels(running: readonly RunningModel[], turn: TokenCounts & { costUsd?: number }, isError: boolean): ModelTurnUsage[] {
    if (running.length === 0) return [];
    // A failed start or crash can report zeroed totals: the real ones carry
    // on with the next result.
    const zeroed = running.every((r) => r.input === 0 && r.output === 0 && r.costUsd === 0);
    if (zeroed && isError) return [];
    // A total below where it was started again (/clear): all of it is new.
    // On an error it is a crash's figure instead, as RunningCost reads it:
    // that model did nothing this turn, and its total stays where it was.
    const rise = (now: number, was = 0) => (now >= was ? now - was : now);
    const rises = running.map((r) => {
      const before = this.last.get(r.key);
      const dropped = !!before && (r.input < before.input || r.output < before.output || r.costUsd < before.costUsd);
      if (dropped && isError) return { input: 0, output: 0, costUsd: 0 };
      this.last.set(r.key, { input: r.input, output: r.output, costUsd: r.costUsd });
      return { input: rise(r.input, before?.input), output: rise(r.output, before?.output), costUsd: rise(r.costUsd, before?.costUsd) };
    });

    const tokenRise = rises.map((d) => d.input + d.output);
    const tokenTotal = running.map((r) => r.input + r.output);
    const input = apportion(turn.input, firstNonZero(rises.map((d) => d.input), running.map((r) => r.input)));
    const output = apportion(turn.output, firstNonZero(rises.map((d) => d.output), running.map((r) => r.output)));
    const costWeights = firstNonZero(rises.map((d) => d.costUsd), tokenRise, running.map((r) => r.costUsd), tokenTotal);
    const costSum = costWeights.reduce((a, w) => a + w, 0);

    // Providers can name one model two ways: show them as one.
    const merged = new Map<string, ModelTurnUsage>();
    /** Each model's tokens over the conversation, for which is the main one. */
    const overall = new Map<string, number>();
    running.forEach((r, i) => {
      const entry = merged.get(r.model) ?? { model: r.model, input: 0, output: 0, ...(turn.costUsd !== undefined ? { costUsd: 0 } : {}) };
      entry.input += input[i];
      entry.output += output[i];
      if (entry.costUsd !== undefined && turn.costUsd !== undefined && costSum > 0) entry.costUsd += (turn.costUsd * costWeights[i]) / costSum;
      merged.set(r.model, entry);
      overall.set(r.model, (overall.get(r.model) ?? 0) + tokenTotal[i]);
    });
    const did = (m: ModelTurnUsage) => m.input + m.output;
    const most = (m: ModelTurnUsage) => overall.get(m.model) ?? 0;
    const used = [...merged.values()]
      .filter((m) => did(m) > 0 || (m.costUsd ?? 0) > 0)
      .sort((a, b) => did(b) - did(a) || (b.costUsd ?? 0) - (a.costUsd ?? 0));
    if (used.length > 0) {
      const main = used.reduce((best, m) => (most(m) > most(best) ? m : best), used[0]);
      return [main, ...used.filter((m) => m !== main)];
    }
    // Nothing to split (a turn that used no tokens): the turn still took
    // time, which goes to the main model.
    const main = [...merged.values()].reduce((best, m) => (most(m) > most(best) ? m : best));
    return [{ model: main.model, input: 0, output: 0, ...(turn.costUsd !== undefined ? { costUsd: 0 } : {}) }];
  }
}

/** Each model's running totals the conversation last reached, from its
 *  history, for a query that resumes it (as lastRunningCost). Null when its
 *  last result has none: a new conversation, or one from before they were
 *  saved. */
export function lastRunningModels(history: readonly AgentEvent[]): Record<string, ModelTotals> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.type === 'agent_changed') return null;
    if (e.type === 'status' && e.newConversation) return null;
    if (e.type === 'result' && (e.sessionTokens || e.sessionModels)) return e.sessionModels ?? null;
  }
  return null;
}
