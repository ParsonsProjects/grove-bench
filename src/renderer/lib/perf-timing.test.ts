import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeSteps, afterNextPaint } from './perf-timing.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeSteps', () => {
  it('reports each step and marks it for DevTools', () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const measure = vi.spyOn(performance, 'measure').mockImplementation(() => undefined as never);
    const report = vi.fn();

    const timing = timeSteps('conversation view', 'abc', report);
    t += 12; timing.step('history fetch');
    t += 30; timing.step('replay');
    timing.done('200 events, shown');

    expect(report).toHaveBeenCalledWith({
      label: 'conversation view',
      sessionId: 'abc',
      steps: [{ name: 'history fetch', ms: 12 }, { name: 'replay', ms: 30 }],
      detail: '200 events, shown',
    });
    expect(measure.mock.calls.map(([name, opts]) => [name, opts])).toEqual([
      ['grove conversation view: history fetch', { start: 1000, end: 1012 }],
      ['grove conversation view: replay', { start: 1012, end: 1042 }],
      ['grove conversation view', { start: 1000, end: 1042 }],
    ]);
  });

  it('still reports where marks are not supported', () => {
    vi.spyOn(performance, 'measure').mockImplementation(() => { throw new TypeError('no options'); });
    const report = vi.fn();
    const timing = timeSteps('x', undefined, report);
    timing.step('a');
    timing.done();
    expect(report).toHaveBeenCalledWith({ label: 'x', steps: [{ name: 'a', ms: expect.any(Number) }] });
  });

  it('sends to main by default', () => {
    timeSteps('x').done();
    expect(window.groveBench.reportTiming).toHaveBeenCalledWith({ label: 'x', steps: [] });
  });
});

describe('afterNextPaint', () => {
  it('resolves after the next frame', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    await afterNextPaint();
    expect(frame).toHaveBeenCalledOnce();
  });
});
