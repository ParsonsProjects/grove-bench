import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../../shared/types.js';
import { RunningCost, lastRunningCost } from './running-cost.js';

describe('RunningCost', () => {
  it('turns running totals into each turn\'s cost', () => {
    const cost = new RunningCost();
    expect(cost.turnCost(0.5, false)).toBeCloseTo(0.5);
    expect(cost.turnCost(0.75, false)).toBeCloseTo(0.25);
    expect(cost.turnCost(1.75, false)).toBeCloseTo(1);
  });

  it('starts a resumed conversation from the total it had reached', () => {
    const cost = new RunningCost(2);
    expect(cost.turnCost(2.3, false)).toBeCloseTo(0.3);
    expect(cost.turnCost(2.5, false)).toBeCloseTo(0.2);
  });

  it('ignores a zeroed total on an error result', () => {
    const cost = new RunningCost();
    cost.turnCost(1, false);
    expect(cost.turnCost(0, true)).toBe(0);
    expect(cost.turnCost(1.2, false)).toBeCloseTo(0.2);
  });

  it('counts the whole total after /clear starts it again', () => {
    const cost = new RunningCost();
    cost.turnCost(3, false);
    expect(cost.turnCost(0.1, false)).toBeCloseTo(0.1);
    expect(cost.turnCost(0.4, false)).toBeCloseTo(0.3);
  });

  it('charges nothing when a resumed total is below where the conversation was', () => {
    const cost = new RunningCost(5);
    expect(cost.turnCost(0.2, false)).toBe(0);
    expect(cost.turnCost(0.5, false)).toBeCloseTo(0.3);
  });

  it('keeps the resumed total through a zeroed first result', () => {
    const cost = new RunningCost(5);
    expect(cost.turnCost(0, true)).toBe(0);
    expect(cost.turnCost(5.4, false)).toBeCloseTo(0.4);
  });
});

describe('lastRunningCost', () => {
  const result = (extra: Partial<Extract<AgentEvent, { type: 'result' }>>): AgentEvent => ({ type: 'result', subtype: 'success', isError: false, ...extra });

  it('reads the last reported running total', () => {
    expect(lastRunningCost([result({ totalCostUsd: 0.2, sessionCostUsd: 0.2 }), result({ totalCostUsd: 0.1, sessionCostUsd: 0.3 })])).toBe(0.3);
  });

  it('reads an older result\'s total, which was the running total', () => {
    expect(lastRunningCost([result({ totalCostUsd: 1.4 })])).toBe(1.4);
  });

  it('skips results that report no cost', () => {
    expect(lastRunningCost([result({ totalCostUsd: 0.5, sessionCostUsd: 0.5 }), result({})])).toBe(0.5);
  });

  it('is null with nothing reported since the agent\'s conversation began', () => {
    expect(lastRunningCost([])).toBeNull();
    expect(lastRunningCost([
      result({ totalCostUsd: 0.5, sessionCostUsd: 0.5 }),
      { type: 'agent_changed', from: 'a', to: 'b', fromName: 'A', toName: 'B', transcript: false },
    ])).toBeNull();
    expect(lastRunningCost([
      result({ totalCostUsd: 0.5, sessionCostUsd: 0.5 }),
      { type: 'status', message: 'Started a new conversation', newConversation: true },
    ])).toBeNull();
  });
});
