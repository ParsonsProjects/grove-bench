import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStepTimer, logWindowTiming, sanitizeTiming } from './perf-steps.js';

function setup(giveUpMs?: number) {
  let t = 0;
  const lines: string[] = [];
  const steps = createStepTimer({ now: () => t, write: (line) => lines.push(line), ...(giveUpMs ? { giveUpMs } : {}) });
  return { steps, lines, advance: (ms: number) => { t += ms; } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('step timer', () => {
  it('writes a started line, then each step and the total once ready', () => {
    const { steps, lines, advance } = setup();
    steps.begin('1a2b3c4d', 'new conversation');
    advance(95); steps.step('1a2b3c4d', 'checks');
    advance(1830); steps.step('1a2b3c4d', 'worktree');
    advance(2285); steps.finish('1a2b3c4d', 'agent start');

    expect(lines).toEqual([
      'new conversation 1a2b3c4d: started',
      'new conversation 1a2b3c4d ready after 4210 ms: checks 95 ms, worktree 1830 ms, agent start 2285 ms',
    ]);
  });

  it('counts from when the work began when that was before the id was known', () => {
    const { steps, lines, advance } = setup();
    advance(500);
    steps.begin('x', 'new conversation', 100);
    steps.finish('x', 'agent start');
    expect(lines[1]).toBe('new conversation x ready after 400 ms: agent start 400 ms');
  });

  it('ignores steps for a conversation with no run going', () => {
    const { steps, lines } = setup();
    steps.step('x', 'agent setup');
    steps.finish('x', 'agent start');
    steps.fail('x', 'oops');
    expect(lines).toEqual([]);
  });

  it('writes up how far a run got when it fails', () => {
    const { steps, lines, advance } = setup();
    steps.begin('x', 'resume');
    advance(40); steps.step('x', 'lookup');
    advance(10); steps.fail('x', 'resume failed');
    expect(lines[1]).toBe('resume x stopped (resume failed) after 50 ms: lookup 40 ms');
  });

  it('gives up on a run that never reports ready', () => {
    vi.useFakeTimers();
    const { steps, lines } = setup(1000);
    steps.begin('x', 'wake');
    vi.advanceTimersByTime(1000);
    expect(lines[1]).toBe('wake x gave up waiting for the agent after 0 ms');
    steps.finish('x', 'agent start');
    expect(lines).toHaveLength(2);
  });

  it('writes up a run that another for the same conversation replaces', () => {
    vi.useFakeTimers();
    const { steps, lines, advance } = setup(1000);
    steps.begin('x', 'resume');
    advance(30); steps.step('x', 'lookup');
    steps.begin('x', 'wake');
    vi.advanceTimersByTime(999);
    steps.finish('x', 'agent start');
    expect(lines).toEqual([
      'resume x: started',
      'resume x stopped (wake started) after 30 ms: lookup 30 ms',
      'wake x: started',
      'wake x ready after 0 ms: agent start 0 ms',
    ]);
  });
});

describe('window timings', () => {
  it('writes a report in the same form', () => {
    const lines: string[] = [];
    logWindowTiming({
      label: 'conversation view',
      sessionId: '1a2b3c4d',
      steps: [{ name: 'history fetch', ms: 12.4 }, { name: 'replay', ms: 30 }, { name: 'first draw', ms: 61.6 }],
      detail: '200 events, shown',
    }, (line) => lines.push(line));
    expect(lines).toEqual(['conversation view 1a2b3c4d took 104 ms: history fetch 12 ms, replay 30 ms, first draw 62 ms (200 events, shown)']);
  });

  it('drops fields that are not plain short text or a time', () => {
    expect(sanitizeTiming({
      label: 'conversation view',
      sessionId: 'id\nwith a newline',
      steps: [{ name: 'ok', ms: 1 }, { name: 'bad<script>', ms: 1 }, { name: 'neg', ms: -1 }, { name: 'inf', ms: Infinity }, null],
      detail: 'x'.repeat(81),
    })).toEqual({ label: 'conversation view', steps: [{ name: 'ok', ms: 1 }] });
  });

  it('ignores a report that is not one', () => {
    const write = vi.fn();
    for (const bad of [null, 'x', { label: 'no steps' }, { label: '', steps: [] }, { label: 'a\nb', steps: [] }]) logWindowTiming(bad, write);
    expect(write).not.toHaveBeenCalled();
  });
});
