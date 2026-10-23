/**
 * Limits that pause a thread before its next tool call (shared/limits.ts):
 * spend per thread and per day, and tool calls and minutes per turn. The
 * agent's adapter asks before each tool call it can hold (beforeToolUse);
 * a reached limit is put to the user in the thread, and Continue lets the
 * thread go on for another round of the setting.
 *
 * Spend is what the agent reports when a turn ends, so a turn already
 * running finishes before a spend limit can catch it. Agents that report no
 * cost (most ACP agents) never reach one.
 */
import { randomUUID } from 'node:crypto';
import { PERMISSION_TIMEOUT_MINUTES } from '../shared/types.js';
import type { AgentEvent, GroveBenchSettings, TokenCounts } from '../shared/types.js';
import { localDay, reachedLimit, type LimitKind, type LimitUsage, type ReachedLimit } from '../shared/limits.js';
import { loadDailySpend, saveDailySpend } from './app-state.js';
import type { Emit } from './session-types.js';

const LIMIT_TIMEOUT_MS = PERMISSION_TIMEOUT_MINUTES * 60 * 1000;
const MINUTE_MS = 60_000;

export type LimitDecision = 'continue' | 'stop';

/** The turn being measured: from the prompt (or the agent's first reply,
 *  for a turn it starts itself) to its result. */
export interface TurnLimits {
  startedAt: number;
  /** Tool calls started this turn, by id (the gate and the event stream
   *  can each see a call first). */
  toolIds: Set<string>;
  /** Time spent waiting on the user, so far, in ms. */
  waitMs: number;
  /** Waits in progress (a permission prompt and a question can overlap). */
  waiting: number;
  waitingSince: number;
  toolAllowance: number | null;
  msAllowance: number | null;
}

/** How a limit question ended: the user answered, nobody did in time, or
 *  the turn stopped some other way first. */
type LimitEnding = 'answered' | 'timeout' | 'cancelled';

interface PendingLimit {
  requestId: string;
  reached: ReachedLimit;
  answer: Promise<LimitDecision>;
  resolve: (decision: LimitDecision, ending: LimitEnding) => void;
}

/** One thread's limit state, kept on its ManagedSession. */
export interface SessionLimits {
  turn: TurnLimits | null;
  /** Estimated spend over the thread's life, from its results. */
  threadSpendUsd: number;
  /** Tokens over the thread's life, from its results. Kept here with the
   *  spend, though no limit counts them yet. */
  threadTokens: TokenCounts;
  /** Where the thread spend limit stands after the user continued past it. */
  threadAllowanceUsd: number | null;
  pending: PendingLimit | null;
  /** The user stopped at a limit (or didn't answer): tool calls are refused
   *  while the turn winds down, until it ends or a new prompt is sent. */
  stopped: boolean;
}

/** A result that counts toward spend: its cost is this turn's own. Results
 *  from before costs were reported per turn carry no running total, and
 *  their figure can't be trusted, so they don't count. */
export function turnSpend(event: AgentEvent): number {
  if (event.type !== 'result' || event.sessionCostUsd === undefined) return 0;
  const usd = event.totalCostUsd ?? 0;
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

/** The tokens a result says its turn used (none when it doesn't say). */
export function turnTokens(event: AgentEvent): TokenCounts {
  if (event.type !== 'result' || !event.turnTokens) return { input: 0, output: 0 };
  const count = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return { input: count(event.turnTokens.input), output: count(event.turnTokens.output) };
}

/** A thread's spend and tokens, and how far the user let it go past its
 *  spend limit, saved in the worktree manifest: a rewind or /clear rewrites
 *  the history these are otherwise rebuilt from. */
export interface SavedThreadLimits {
  spendUsd: number;
  allowanceUsd?: number;
  tokens?: TokenCounts;
}

/** What to save of a live thread's limit state. */
export function savedThreadLimits(limits: SessionLimits): SavedThreadLimits {
  const { input, output } = limits.threadTokens;
  return {
    spendUsd: limits.threadSpendUsd,
    ...(limits.threadAllowanceUsd !== null ? { allowanceUsd: limits.threadAllowanceUsd } : {}),
    ...(input > 0 || output > 0 ? { tokens: { input, output } } : {}),
  };
}

/** A thread's limit state from its saved history: what it has spent, and
 *  how far the user last let it go past its spend limit. `saved`: what was
 *  recorded when it last ran, which still counts turns a rewind or /clear
 *  has since cut from the history. */
export function limitsFromHistory(history: readonly AgentEvent[], saved?: SavedThreadLimits): SessionLimits {
  let threadSpendUsd = 0;
  const threadTokens: TokenCounts = { input: 0, output: 0 };
  let threadAllowanceUsd: number | null = null;
  for (const e of history) {
    threadSpendUsd += turnSpend(e);
    const tokens = turnTokens(e);
    threadTokens.input += tokens.input;
    threadTokens.output += tokens.output;
    if (e.type === 'limit_resolved' && e.limit === 'threadSpend' && e.decision === 'continue' && e.allowance !== undefined) {
      threadAllowanceUsd = e.allowance;
    }
  }
  threadSpendUsd = Math.max(threadSpendUsd, saved?.spendUsd ?? 0);
  threadTokens.input = Math.max(threadTokens.input, saved?.tokens?.input ?? 0);
  threadTokens.output = Math.max(threadTokens.output, saved?.tokens?.output ?? 0);
  if (saved?.allowanceUsd !== undefined) threadAllowanceUsd = Math.max(threadAllowanceUsd ?? 0, saved.allowanceUsd);
  return { turn: null, threadSpendUsd, threadTokens, threadAllowanceUsd, pending: null, stopped: false };
}

// ─── Daily spend ───

/** Today's spend across threads and the daily allowance, if continued past. */
export function todaySpend(now = Date.now()): { usd: number; allowanceUsd: number | null } {
  const saved = loadDailySpend();
  if (!saved || saved.day !== localDay(now)) return { usd: 0, allowanceUsd: null };
  return { usd: saved.usd, allowanceUsd: saved.allowanceUsd ?? null };
}

function saveToday(usd: number, allowanceUsd: number | null, now: number): void {
  saveDailySpend({ day: localDay(now), usd, ...(allowanceUsd !== null ? { allowanceUsd } : {}) });
}

// ─── Turns ───

function newTurn(now: number): TurnLimits {
  return { startedAt: now, toolIds: new Set(), waitMs: 0, waiting: 0, waitingSince: 0, toolAllowance: null, msAllowance: null };
}

/** A prompt is going to the agent: start measuring a turn if none is
 *  running, and lift a stop from the turn before. */
export function promptSent(limits: SessionLimits, now = Date.now()): void {
  limits.stopped = false;
  limits.turn ??= newTurn(now);
}

/** The agent is replying: a turn it started itself is measured too. */
export function turnActive(limits: SessionLimits, now = Date.now()): void {
  limits.turn ??= newTurn(now);
}

/** A tool call the agent made, counted toward this turn's tool calls. Calls
 *  between turns (a background subagent's) count toward no turn. */
export function toolCallSeen(limits: SessionLimits, toolUseId: string): void {
  limits.turn?.toolIds.add(toolUseId);
}

/** The turn ended (its result arrived): add what it cost to the thread's
 *  and today's spend and its tokens to the thread's, and stop measuring it. */
export function turnEnded(limits: SessionLimits, result: AgentEvent, now = Date.now()): void {
  const tokens = turnTokens(result);
  limits.threadTokens.input += tokens.input;
  limits.threadTokens.output += tokens.output;
  const usd = turnSpend(result);
  if (usd > 0) {
    limits.threadSpendUsd += usd;
    const today = todaySpend(now);
    saveToday(today.usd + usd, today.allowanceUsd, now);
  }
  limits.turn = null;
  limits.stopped = false;
}

/** The turn was stopped: whatever it does next isn't measured. */
export function turnStopped(limits: SessionLimits): void {
  limits.turn = null;
}

/** How long the turn has run, without time spent waiting on the user. */
export function turnElapsedMs(turn: TurnLimits, now = Date.now()): number {
  const waitingNow = turn.waiting > 0 ? now - turn.waitingSince : 0;
  return Math.max(0, now - turn.startedAt - turn.waitMs - waitingNow);
}

/** Don't count the time `wait` takes toward the turn's minutes: the thread
 *  is waiting on the user (a permission prompt, a question, a limit). */
export function whileWaiting<T>(limits: SessionLimits, wait: Promise<T>, now: () => number = Date.now): Promise<T> {
  const turn = limits.turn;
  if (!turn) return wait;
  if (turn.waiting++ === 0) turn.waitingSince = now();
  const done = () => {
    if (--turn.waiting === 0) turn.waitMs += now() - turn.waitingSince;
  };
  return wait.finally(done);
}

export function limitUsage(limits: SessionLimits, now = Date.now()): LimitUsage {
  const today = todaySpend(now);
  const turn = limits.turn;
  return {
    dailySpendUsd: today.usd,
    dailyAllowanceUsd: today.allowanceUsd,
    threadSpendUsd: limits.threadSpendUsd,
    threadAllowanceUsd: limits.threadAllowanceUsd,
    turnToolCalls: turn?.toolIds.size ?? 0,
    turnToolAllowance: turn?.toolAllowance ?? null,
    turnMs: turn ? turnElapsedMs(turn, now) : 0,
    turnMsAllowance: turn?.msAllowance ?? null,
  };
}

// ─── The gate ───

export interface LimitGateContext {
  limits: SessionLimits;
  settings: GroveBenchSettings;
  emit: Emit;
  /** Stop the turn, once the user chose to (or didn't answer in time). */
  stopTurn: () => void;
  now?: () => number;
}

/**
 * Called before a tool call runs. Resolves 'continue' at once while no limit
 * is reached; otherwise asks in the thread and waits. Parallel calls share
 * the one question. 'stop' means refuse the call: the turn is being stopped.
 */
export function beforeToolUse(ctx: LimitGateContext, toolUseId: string): Promise<LimitDecision> {
  const { limits } = ctx;
  if (limits.stopped) return Promise.resolve('stop');
  toolCallSeen(limits, toolUseId);
  if (limits.pending) return limits.pending.answer;
  const now = ctx.now ?? Date.now;
  const reached = reachedLimit(ctx.settings, limitUsage(limits, now()));
  if (!reached) return Promise.resolve('continue');
  return askToContinue(ctx, reached);
}

function askToContinue(ctx: LimitGateContext, reached: ReachedLimit): Promise<LimitDecision> {
  const { limits, emit } = ctx;
  const now = ctx.now ?? Date.now;
  const requestId = `limit_${randomUUID()}`;
  let resolve!: PendingLimit['resolve'];
  const answer = new Promise<LimitDecision>((done) => {
    const timer = setTimeout(() => resolve('stop', 'timeout'), LIMIT_TIMEOUT_MS);
    resolve = (decision, ending) => {
      if (limits.pending?.requestId !== requestId) return;
      clearTimeout(timer);
      limits.pending = null;
      const allowance = decision === 'continue' ? allow(limits, reached, now()) : undefined;
      if (decision === 'stop') limits.stopped = true;
      emit({
        type: 'limit_resolved',
        requestId,
        limit: reached.limit,
        decision,
        ...(allowance !== undefined ? { allowance } : {}),
        ...(ending === 'timeout' ? { reason: 'timeout' as const } : {}),
      });
      done(decision);
      if (decision === 'stop' && ending !== 'cancelled') ctx.stopTurn();
    };
  });
  limits.pending = { requestId, reached, answer, resolve };
  emit({
    type: 'limit_request',
    requestId,
    limit: reached.limit,
    used: reached.used,
    reachedAt: reached.reachedAt,
    nextAllowance: reached.nextAllowance,
  });
  return whileWaiting(limits, answer, now);
}

/** Let the thread go on to `reached.nextAllowance`. Returns the allowance
 *  in the limit's units, for the log. */
function allow(limits: SessionLimits, reached: ReachedLimit, now: number): number {
  const next = reached.nextAllowance;
  switch (reached.limit) {
    case 'dailySpend': {
      const today = todaySpend(now);
      saveToday(today.usd, next, now);
      break;
    }
    case 'threadSpend':
      limits.threadAllowanceUsd = next;
      break;
    case 'turnToolCalls':
      if (limits.turn) limits.turn.toolAllowance = next;
      break;
    case 'turnMinutes':
      if (limits.turn) limits.turn.msAllowance = next * MINUTE_MS;
      break;
  }
  return next;
}

/** Answer the limit question waiting in the thread. False when there is
 *  none with this id (already answered, stopped or timed out). */
export function respondToLimit(limits: SessionLimits, requestId: string, decision: LimitDecision): boolean {
  const pending = limits.pending;
  if (!pending || pending.requestId !== requestId) return false;
  pending.resolve(decision, 'answered');
  return true;
}

/** The turn is stopping some other way (Stop, sleep, close): settle a limit
 *  question still waiting, without stopping the turn a second time. */
export function cancelLimit(limits: SessionLimits): void {
  limits.pending?.resolve('stop', 'cancelled');
}

export type { LimitKind };
