import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent, GroveBenchSettings } from '../shared/types.js';
import type { DailySpend } from './app-state.js';

const saved = vi.hoisted(() => ({ value: null as DailySpend | null }));
vi.mock('./app-state.js', () => ({
  loadDailySpend: () => saved.value,
  saveDailySpend: (spend: DailySpend) => { saved.value = spend; },
}));

import {
  beforeToolUse, cancelLimit, limitsFromHistory, promptSent, respondToLimit, todaySpend,
  turnActive, turnElapsedMs, turnEnded, turnSpend, whileWaiting, type LimitGateContext, type SessionLimits,
} from './session-limits.js';

const MIN = 60_000;

function settings(over: Partial<GroveBenchSettings> = {}): GroveBenchSettings {
  return { dailySpendLimitUsd: 0, threadSpendLimitUsd: 0, turnToolCallLimit: 0, turnMinutesLimit: 0, ...over } as GroveBenchSettings;
}

/** `sessionCostUsd` null: a result from before costs were per turn. */
function result(totalCostUsd: number, sessionCostUsd: number | null = totalCostUsd): AgentEvent {
  return { type: 'result', subtype: 'success', isError: false, totalCostUsd, ...(sessionCostUsd !== null ? { sessionCostUsd } : {}) };
}

function gate(limits: SessionLimits, over: Partial<GroveBenchSettings>, now = () => Date.now()) {
  const events: AgentEvent[] = [];
  const stopTurn = vi.fn();
  const ctx: LimitGateContext = { limits, settings: settings(over), emit: (e) => events.push(e), stopTurn, now };
  return { ctx, events, stopTurn };
}

beforeEach(() => {
  saved.value = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 12, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('spend', () => {
  it('counts a turn only when it came with a running total', () => {
    expect(turnSpend(result(0.4))).toBe(0.4);
    // Before costs were per turn, Claude Code's figure was the running total.
    expect(turnSpend(result(3, null))).toBe(0);
    expect(turnSpend({ type: 'status', message: 'x' })).toBe(0);
  });

  it('keeps a saved total that turns cut from the history still count toward', () => {
    expect(limitsFromHistory([result(0.5, 0.5)], 3).threadSpendUsd).toBe(3);
    // A save that missed the last turn doesn't lower it.
    expect(limitsFromHistory([result(0.5, 0.5), result(0.25, 0.75)], 0.5).threadSpendUsd).toBeCloseTo(0.75);
    expect(limitsFromHistory([], undefined).threadSpendUsd).toBe(0);
  });

  it('rebuilds a thread\'s spend and allowance from its history', () => {
    const limits = limitsFromHistory([
      result(3, null),
      result(0.5, 3.5),
      { type: 'limit_resolved', requestId: 'a', limit: 'threadSpend', decision: 'continue', allowance: 10 },
      result(0.25, 3.75),
    ]);
    expect(limits.threadSpendUsd).toBeCloseTo(0.75);
    expect(limits.threadAllowanceUsd).toBe(10);
  });

  it('adds each turn to the thread and to today', () => {
    const limits = limitsFromHistory([]);
    turnEnded(limits, result(0.5));
    turnEnded(limits, result(0.25, 0.75));
    expect(limits.threadSpendUsd).toBeCloseTo(0.75);
    expect(todaySpend().usd).toBeCloseTo(0.75);
  });

  it('starts today\'s spend again at local midnight', () => {
    turnEnded(limitsFromHistory([]), result(2));
    vi.setSystemTime(new Date(2026, 9, 12, 0, 5));
    expect(todaySpend()).toEqual({ usd: 0, allowanceUsd: null });
  });
});

describe('turn time', () => {
  it('leaves out time spent waiting on the user', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    vi.advanceTimersByTime(2 * MIN);
    let answer!: () => void;
    const waiting = whileWaiting(limits, new Promise<void>((r) => { answer = r; }));
    vi.advanceTimersByTime(10 * MIN);
    expect(turnElapsedMs(limits.turn!)).toBe(2 * MIN);
    answer();
    await waiting;
    vi.advanceTimersByTime(MIN);
    expect(turnElapsedMs(limits.turn!)).toBe(3 * MIN);
  });
});

describe('beforeToolUse', () => {
  it('lets calls through while no limit is reached', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events } = gate(limits, { turnToolCallLimit: 2 });
    await expect(beforeToolUse(ctx, 't1')).resolves.toBe('continue');
    await expect(beforeToolUse(ctx, 't2')).resolves.toBe('continue');
    expect(events).toEqual([]);
  });

  it('pauses past the tool call limit and goes on after Continue', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events, stopTurn } = gate(limits, { turnToolCallLimit: 2 });
    await beforeToolUse(ctx, 't1');
    await beforeToolUse(ctx, 't2');
    const third = beforeToolUse(ctx, 't3');
    expect(events[0]).toMatchObject({ type: 'limit_request', limit: 'turnToolCalls', used: 2, reachedAt: 2, nextAllowance: 4 });
    const requestId = (events[0] as Extract<AgentEvent, { type: 'limit_request' }>).requestId;
    expect(respondToLimit(limits, requestId, 'continue')).toBe(true);
    await expect(third).resolves.toBe('continue');
    expect(events[1]).toMatchObject({ type: 'limit_resolved', requestId, decision: 'continue', allowance: 4 });
    await expect(beforeToolUse(ctx, 't4')).resolves.toBe('continue');
    expect(stopTurn).not.toHaveBeenCalled();
  });

  it('asks once for calls made side by side', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events } = gate(limits, { turnToolCallLimit: 1 });
    await beforeToolUse(ctx, 't1');
    const a = beforeToolUse(ctx, 't2');
    const b = beforeToolUse(ctx, 't3');
    expect(events.filter((e) => e.type === 'limit_request')).toHaveLength(1);
    respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'stop');
    await expect(a).resolves.toBe('stop');
    await expect(b).resolves.toBe('stop');
  });

  it('stops the turn when the user stops, and refuses its later calls', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events, stopTurn } = gate(limits, { threadSpendLimitUsd: 1 });
    limits.threadSpendUsd = 1.5;
    const call = beforeToolUse(ctx, 't1');
    expect(events[0]).toMatchObject({ type: 'limit_request', limit: 'threadSpend' });
    respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'stop');
    await expect(call).resolves.toBe('stop');
    expect(stopTurn).toHaveBeenCalledOnce();
    await expect(beforeToolUse(ctx, 't2')).resolves.toBe('stop');
    // The next prompt lifts it (and the limit asks again).
    promptSent(limits);
    void beforeToolUse(ctx, 't3');
    expect(events.filter((e) => e.type === 'limit_request')).toHaveLength(2);
  });

  it('keeps a thread\'s spend allowance after Continue', async () => {
    const limits = limitsFromHistory([]);
    const { ctx, events } = gate(limits, { threadSpendLimitUsd: 1 });
    limits.threadSpendUsd = 1.2;
    const call = beforeToolUse(ctx, 't1');
    respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'continue');
    await call;
    expect(limits.threadAllowanceUsd).toBeCloseTo(2.2);
    expect(events[1]).toMatchObject({ type: 'limit_resolved', limit: 'threadSpend', allowance: 2.2 });
  });

  it('saves the daily allowance for every thread after Continue', async () => {
    turnEnded(limitsFromHistory([]), result(21));
    const limits = limitsFromHistory([]);
    const { ctx, events } = gate(limits, { dailySpendLimitUsd: 20 });
    const call = beforeToolUse(ctx, 't1');
    expect(events[0]).toMatchObject({ limit: 'dailySpend', used: 21, reachedAt: 20, nextAllowance: 41 });
    respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'continue');
    await call;
    expect(todaySpend()).toEqual({ usd: 21, allowanceUsd: 41 });
    const other = limitsFromHistory([]);
    await expect(beforeToolUse(gate(other, { dailySpendLimitUsd: 20 }).ctx, 'u1')).resolves.toBe('continue');
  });

  it('pauses a turn that has run too long, and the pause doesn\'t count toward it', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events } = gate(limits, { turnMinutesLimit: 10 });
    vi.advanceTimersByTime(11 * MIN);
    const call = beforeToolUse(ctx, 't1');
    expect(events[0]).toMatchObject({ limit: 'turnMinutes', used: 11, reachedAt: 10, nextAllowance: 21 });
    vi.advanceTimersByTime(5 * MIN);
    respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'continue');
    await call;
    vi.advanceTimersByTime(9 * MIN);
    await expect(beforeToolUse(ctx, 't2')).resolves.toBe('continue');
  });

  it('stops the turn when nobody answers in time', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events, stopTurn } = gate(limits, { turnToolCallLimit: 1 });
    await beforeToolUse(ctx, 't1');
    const call = beforeToolUse(ctx, 't2');
    vi.advanceTimersByTime(30 * MIN);
    await expect(call).resolves.toBe('stop');
    expect(events[1]).toMatchObject({ type: 'limit_resolved', decision: 'stop', reason: 'timeout' });
    expect(stopTurn).toHaveBeenCalledOnce();
  });

  it('settles a waiting question when the turn stops some other way, without stopping it again', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events, stopTurn } = gate(limits, { turnToolCallLimit: 1 });
    await beforeToolUse(ctx, 't1');
    const call = beforeToolUse(ctx, 't2');
    cancelLimit(limits);
    await expect(call).resolves.toBe('stop');
    expect(events[1]).toMatchObject({ type: 'limit_resolved', decision: 'stop' });
    expect(stopTurn).not.toHaveBeenCalled();
    expect(respondToLimit(limits, (events[0] as { requestId: string }).requestId, 'continue')).toBe(false);
  });

  it('counts calls toward a turn the agent started by itself', async () => {
    const limits = limitsFromHistory([]);
    turnActive(limits);
    const { ctx, events } = gate(limits, { turnToolCallLimit: 1 });
    await beforeToolUse(ctx, 't1');
    void beforeToolUse(ctx, 't2');
    expect(events[0]).toMatchObject({ type: 'limit_request', limit: 'turnToolCalls' });
  });

  it('a new turn starts the tool call count again', async () => {
    const limits = limitsFromHistory([]);
    promptSent(limits);
    const { ctx, events } = gate(limits, { turnToolCallLimit: 1 });
    await beforeToolUse(ctx, 't1');
    turnEnded(limits, result(0.1));
    promptSent(limits);
    await expect(beforeToolUse(ctx, 't2')).resolves.toBe('continue');
    expect(events).toEqual([]);
  });
});
