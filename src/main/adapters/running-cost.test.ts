import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../../shared/types.js';
import { RunningCost, RunningModels, RunningTokens, lastRunningCost, lastRunningModels, lastRunningTokens, type RunningModel } from './running-cost.js';

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

describe('RunningTokens', () => {
  it('turns running totals into each turn\'s tokens, input and output apart', () => {
    const t = new RunningTokens();
    expect(t.turnTokens({ input: 1000, output: 50 }, false)).toEqual({ input: 1000, output: 50 });
    expect(t.turnTokens({ input: 2500, output: 80 }, false)).toEqual({ input: 1500, output: 30 });
  });

  it('starts a resumed conversation from the totals it had reached, and counts afresh after /clear', () => {
    const t = new RunningTokens({ input: 1000, output: 50 });
    expect(t.turnTokens({ input: 1200, output: 70 }, false)).toEqual({ input: 200, output: 20 });
    expect(t.turnTokens({ input: 300, output: 10 }, false)).toEqual({ input: 300, output: 10 });
  });
});

describe('lastRunningTokens', () => {
  const result = (extra: Partial<Extract<AgentEvent, { type: 'result' }>>): AgentEvent => ({ type: 'result', subtype: 'success', isError: false, ...extra });

  it('reads the last reported running totals, skipping results without them', () => {
    expect(lastRunningTokens([
      result({ sessionTokens: { input: 10, output: 1 } }),
      result({ sessionTokens: { input: 30, output: 4 } }),
      result({}),
    ])).toEqual({ input: 30, output: 4 });
  });

  it('is null with nothing reported since the agent\'s conversation began', () => {
    expect(lastRunningTokens([])).toBeNull();
    expect(lastRunningTokens([
      result({ sessionTokens: { input: 10, output: 1 } }),
      { type: 'agent_changed', from: 'a', to: 'b', fromName: 'A', toName: 'B', transcript: false },
    ])).toBeNull();
  });
});

describe('RunningModels', () => {
  const opus = (input: number, output: number, costUsd: number): RunningModel => ({ key: 'claude-opus-5-5[1m]', model: 'claude-opus-5-5', input, output, costUsd });
  const haiku = (input: number, output: number, costUsd: number): RunningModel => ({ key: 'claude-haiku-5-5', model: 'claude-haiku-5-5', input, output, costUsd });

  it('splits a turn by how much each model did since the last result', () => {
    const models = new RunningModels();
    expect(models.turnModels([opus(1000, 100, 1)], { input: 1000, output: 100, costUsd: 1 }, false))
      .toEqual([{ model: 'claude-opus-5-5', input: 1000, output: 100, costUsd: 1 }]);
    // Opus did 500 more in, Haiku 1500 (a subagent): the turn is 2000 in.
    // Opus is still the thread's main model, so it comes first (the turn's
    // time goes to it).
    const turn = models.turnModels([opus(1500, 140, 1.5), haiku(1500, 60, 0.1)], { input: 2000, output: 100, costUsd: 0.6 }, false);
    expect(turn).toEqual([
      { model: 'claude-opus-5-5', input: 500, output: 40, costUsd: expect.closeTo(0.5, 6) },
      { model: 'claude-haiku-5-5', input: 1500, output: 60, costUsd: expect.closeTo(0.1, 6) },
    ]);
  });

  it('always adds up to the turn, rounding to whole tokens', () => {
    const models = new RunningModels();
    const turn = models.turnModels([opus(1, 1, 1), haiku(1, 1, 1), { ...haiku(1, 1, 1), key: 'other', model: 'other' }], { input: 10, output: 7, costUsd: 0.3 }, false);
    expect(turn.reduce((a, m) => a + m.input, 0)).toBe(10);
    expect(turn.reduce((a, m) => a + m.output, 0)).toBe(7);
    expect(turn.reduce((a, m) => a + (m.costUsd ?? 0), 0)).toBeCloseTo(0.3);
  });

  it('carries on from the totals a resumed conversation had reached', () => {
    const models = new RunningModels({ 'claude-opus-5-5[1m]': { input: 5000, output: 500, costUsd: 3 } });
    // The resumed query starts from its transcript's totals: Haiku's 300 is
    // this turn's, and Opus's 200 more.
    expect(models.turnModels([opus(5200, 520, 3.2), haiku(300, 10, 0.01)], { input: 500, output: 30, costUsd: 0.21 }, false)).toEqual([
      { model: 'claude-opus-5-5', input: 200, output: 20, costUsd: expect.closeTo(0.2, 6) },
      { model: 'claude-haiku-5-5', input: 300, output: 10, costUsd: expect.closeTo(0.01, 6) },
    ]);
  });

  it('splits by the running totals when a resumed conversation saved none', () => {
    const models = new RunningModels();
    // A conversation from before models were saved: its whole totals show up
    // in the first result, but the turn is only 100 in.
    const turn = models.turnModels([opus(9000, 900, 9), haiku(1000, 100, 1)], { input: 100, output: 10, costUsd: 0.1 }, false);
    expect(turn).toEqual([
      { model: 'claude-opus-5-5', input: 90, output: 9, costUsd: expect.closeTo(0.09, 6) },
      { model: 'claude-haiku-5-5', input: 10, output: 1, costUsd: expect.closeTo(0.01, 6) },
    ]);
  });

  it('counts the whole total after /clear starts a model again', () => {
    const models = new RunningModels();
    models.turnModels([opus(5000, 500, 5)], { input: 5000, output: 500, costUsd: 5 }, false);
    expect(models.turnModels([opus(100, 10, 0.1), haiku(100, 10, 0.1)], { input: 200, output: 20, costUsd: 0.2 }, false)
      .map((m) => [m.model, m.input])).toEqual([['claude-opus-5-5', 100], ['claude-haiku-5-5', 100]]);
  });

  it('ignores zeroed totals on an error result', () => {
    const models = new RunningModels();
    models.turnModels([opus(1000, 100, 1)], { input: 1000, output: 100, costUsd: 1 }, false);
    expect(models.turnModels([opus(0, 0, 0)], { input: 0, output: 0, costUsd: 0 }, true)).toEqual([]);
    expect(models.totals).toEqual({ 'claude-opus-5-5[1m]': { input: 1000, output: 100, costUsd: 1 } });
    expect(models.turnModels([opus(1200, 110, 1.2)], { input: 200, output: 10, costUsd: 0.2 }, false)[0]).toMatchObject({ input: 200, output: 10 });
  });

  it('puts the main model first only while it has done the most', () => {
    const models = new RunningModels();
    models.turnModels([opus(1000, 100, 1), haiku(0, 0, 0)], { input: 1000, output: 100, costUsd: 1 }, false);
    // A turn of mostly Haiku: Opus has still done the most overall.
    expect(models.turnModels([opus(1100, 110, 1.1), haiku(800, 80, 0.08)], { input: 900, output: 90, costUsd: 0.18 }, false)[0].model).toBe('claude-opus-5-5');
    // Once Haiku has done more over the thread, it is the main one.
    expect(models.turnModels([opus(1150, 115, 1.15), haiku(2000, 200, 0.2)], { input: 1250, output: 125, costUsd: 0.17 }, false)[0].model).toBe('claude-haiku-5-5');
  });

  it('keeps a model\'s totals through an error that reports them lower', () => {
    const models = new RunningModels();
    models.turnModels([opus(1000, 100, 1), haiku(500, 50, 0.05)], { input: 1500, output: 150, costUsd: 1.05 }, false);
    // A crash reports Opus lower but not zeroed: as RunningCost, it did
    // nothing this turn and its total stays.
    const crashed = models.turnModels([opus(400, 40, 0.4), haiku(600, 60, 0.06)], { input: 100, output: 10, costUsd: 0.01 }, true);
    expect(crashed).toEqual([{ model: 'claude-haiku-5-5', input: 100, output: 10, costUsd: expect.closeTo(0.01, 6) }]);
    expect(models.totals['claude-opus-5-5[1m]']).toEqual({ input: 1000, output: 100, costUsd: 1 });
    // The next turn measures from the totals before the crash.
    expect(models.turnModels([opus(1200, 120, 1.2), haiku(600, 60, 0.06)], { input: 200, output: 20, costUsd: 0.2 }, false))
      .toEqual([{ model: 'claude-opus-5-5', input: 200, output: 20, costUsd: expect.closeTo(0.2, 6) }]);
  });

  it('shows two names for one model as one', () => {
    const models = new RunningModels();
    const alias = { ...opus(500, 50, 0.5), key: 'us.anthropic.claude-opus-5-5' };
    expect(models.turnModels([opus(500, 50, 0.5), alias], { input: 1000, output: 100, costUsd: 1 }, false))
      .toEqual([{ model: 'claude-opus-5-5', input: 1000, output: 100, costUsd: expect.closeTo(1, 6) }]);
  });

  it('gives a turn that used no tokens to the model that has done the most', () => {
    const models = new RunningModels();
    models.turnModels([opus(1000, 100, 1), haiku(10, 1, 0.01)], { input: 1010, output: 101, costUsd: 1.01 }, false);
    expect(models.turnModels([opus(1000, 100, 1), haiku(10, 1, 0.01)], { input: 0, output: 0, costUsd: 0 }, false))
      .toEqual([{ model: 'claude-opus-5-5', input: 0, output: 0, costUsd: 0 }]);
  });

  it('leaves out cost when the turn has none, and names no models without any', () => {
    const models = new RunningModels();
    expect(models.turnModels([opus(100, 10, 0)], { input: 100, output: 10 }, false)).toEqual([{ model: 'claude-opus-5-5', input: 100, output: 10 }]);
    expect(models.turnModels([], { input: 100, output: 10 }, false)).toEqual([]);
  });
});

describe('lastRunningModels', () => {
  const result = (extra: Partial<Extract<AgentEvent, { type: 'result' }>>): AgentEvent => ({ type: 'result', subtype: 'success', isError: false, ...extra });

  it('reads the last result\'s totals by model', () => {
    const totals = { opus: { input: 10, output: 1, costUsd: 0.1 } };
    expect(lastRunningModels([result({ sessionTokens: { input: 1, output: 1 } }), result({ sessionTokens: { input: 10, output: 1 }, sessionModels: totals })])).toEqual(totals);
  });

  it('is null when the last result has none, or a new conversation began since', () => {
    const totals = { opus: { input: 10, output: 1, costUsd: 0.1 } };
    expect(lastRunningModels([result({ sessionModels: totals }), result({ sessionTokens: { input: 20, output: 2 } })])).toBeNull();
    expect(lastRunningModels([result({ sessionModels: totals }), { type: 'status', message: 'New', newConversation: true }])).toBeNull();
    expect(lastRunningModels([result({ sessionModels: totals }), { type: 'agent_changed', from: 'a', to: 'b', fromName: 'A', toName: 'B', transcript: true }])).toBeNull();
    expect(lastRunningModels([])).toBeNull();
  });
});
