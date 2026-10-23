import { describe, it, expect } from 'vitest';
import { formatUsd, limitGrantText, limitReachedText, localDay, reachedLimit, type LimitSettings, type LimitUsage } from './limits.js';

const OFF: LimitSettings = { dailySpendLimitUsd: 0, threadSpendLimitUsd: 0, turnToolCallLimit: 0, turnMinutesLimit: 0 };
const NONE: LimitUsage = {
  dailySpendUsd: 0, dailyAllowanceUsd: null,
  threadSpendUsd: 0, threadAllowanceUsd: null,
  turnToolCalls: 0, turnToolAllowance: null,
  turnMs: 0, turnMsAllowance: null,
};
const MIN = 60_000;

describe('reachedLimit', () => {
  it('reaches nothing with every limit off, however much is used', () => {
    expect(reachedLimit(OFF, { ...NONE, dailySpendUsd: 500, threadSpendUsd: 500, turnToolCalls: 5000, turnMs: 600 * MIN })).toBeNull();
  });

  it('reaches a spend limit once spend gets to it', () => {
    const settings = { ...OFF, threadSpendLimitUsd: 5 };
    expect(reachedLimit(settings, { ...NONE, threadSpendUsd: 4.99 })).toBeNull();
    expect(reachedLimit(settings, { ...NONE, threadSpendUsd: 5.2 })).toEqual({ limit: 'threadSpend', used: 5.2, reachedAt: 5, nextAllowance: 10.2 });
  });

  it('checks the daily limit before the thread limit', () => {
    const settings = { ...OFF, dailySpendLimitUsd: 20, threadSpendLimitUsd: 5 };
    expect(reachedLimit(settings, { ...NONE, dailySpendUsd: 21, threadSpendUsd: 6 })?.limit).toBe('dailySpend');
  });

  it('lets the call at the tool call limit run and pauses the one after', () => {
    const settings = { ...OFF, turnToolCallLimit: 100 };
    expect(reachedLimit(settings, { ...NONE, turnToolCalls: 100 })).toBeNull();
    expect(reachedLimit(settings, { ...NONE, turnToolCalls: 101 })).toEqual({ limit: 'turnToolCalls', used: 100, reachedAt: 100, nextAllowance: 200 });
  });

  it('reaches the time limit in minutes', () => {
    const settings = { ...OFF, turnMinutesLimit: 30 };
    expect(reachedLimit(settings, { ...NONE, turnMs: 29 * MIN })).toBeNull();
    expect(reachedLimit(settings, { ...NONE, turnMs: 31 * MIN })).toEqual({ limit: 'turnMinutes', used: 31, reachedAt: 30, nextAllowance: 61 });
  });

  it('goes on to the allowance after Continue', () => {
    const settings = { ...OFF, threadSpendLimitUsd: 5, turnToolCallLimit: 100 };
    expect(reachedLimit(settings, { ...NONE, threadSpendUsd: 7, threadAllowanceUsd: 10.2 })).toBeNull();
    expect(reachedLimit(settings, { ...NONE, threadSpendUsd: 10.5, threadAllowanceUsd: 10.2 })?.reachedAt).toBe(10.2);
    expect(reachedLimit(settings, { ...NONE, turnToolCalls: 150, turnToolAllowance: 200 })).toBeNull();
  });

  it('uses a raised setting over an older, lower allowance', () => {
    const settings = { ...OFF, threadSpendLimitUsd: 20 };
    expect(reachedLimit(settings, { ...NONE, threadSpendUsd: 12, threadAllowanceUsd: 10 })).toBeNull();
  });

  it('ignores an allowance once its limit is turned off', () => {
    expect(reachedLimit(OFF, { ...NONE, threadSpendUsd: 12, threadAllowanceUsd: 10 })).toBeNull();
  });
});

describe('limit text', () => {
  it('formats dollars to the cent', () => {
    expect(formatUsd(5)).toBe('$5.00');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('says why the thread paused', () => {
    expect(limitReachedText('threadSpend', 5.2, 5)).toBe('This thread has spent about $5.20, which reached your limit of $5.00.');
    expect(limitReachedText('turnToolCalls', 1, 1)).toBe('This turn has made 1 tool call, your limit for one turn.');
    expect(limitReachedText('turnMinutes', 30.6, 30)).toBe('This turn has run for 30 minutes, your limit for one turn.');
  });

  it('says what Continue grants', () => {
    expect(limitGrantText('dailySpend', 20)).toBe('another $20.00');
    expect(limitGrantText('turnMinutes', 1)).toBe('another 1 minute');
  });
});

describe('localDay', () => {
  it('names the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 0, 6, 0, 1).getTime())).toBe('2026-01-06');
  });
});
