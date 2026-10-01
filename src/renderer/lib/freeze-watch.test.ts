import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeEntry, installFreezeWatch, FREEZE_MS } from './freeze-watch.js';

/** A PerformanceObserver whose entries the test delivers by hand. */
function stubObserver(supportedEntryTypes: string[]) {
  const made: { callback: PerformanceObserverCallback; observed: PerformanceObserverInit[]; disconnected: boolean }[] = [];
  class FakeObserver {
    static supportedEntryTypes = supportedEntryTypes;
    record: (typeof made)[number];
    constructor(callback: PerformanceObserverCallback) {
      this.record = { callback, observed: [], disconnected: false };
      made.push(this.record);
    }
    observe(init: PerformanceObserverInit) { this.record.observed.push(init); }
    disconnect() { this.record.disconnected = true; }
  }
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  const deliver = (entries: Partial<PerformanceEntry>[]) =>
    made[0].callback({ getEntries: () => entries } as never, made[0] as never);
  return { made, deliver };
}

const frame = (extra: Record<string, unknown> = {}) => ({
  entryType: 'long-animation-frame',
  startTime: 1000,
  duration: 400,
  ...extra,
}) as unknown as PerformanceEntry;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeEntry', () => {
  it('reports a frame with its style and layout time and three longest scripts', () => {
    const report = describeEntry(frame({
      styleAndLayoutStart: 1250,
      scripts: [
        { duration: 20, invoker: 'IntersectionObserver.callback' },
        { duration: 90, invoker: 'FrameRequestCallback', sourceURL: 'file:///C:/app/dist/renderer/assets/index-Ab12.js', sourceCharPosition: 4521, sourceFunctionName: 'flush', forcedStyleAndLayoutDuration: 31.6 },
        { duration: 60, invoker: 'Promise.then', sourceURL: 'file:///C:/app/dist/renderer/assets/markdown-Cd34.js', sourceCharPosition: -1 },
        { duration: 5, invoker: 'TimerHandler:setTimeout' },
      ],
    }));
    expect(report).toEqual({
      kind: 'frame',
      durationMs: 400,
      renderMs: 150,
      scripts: [
        'FrameRequestCallback flush (index-Ab12.js:4521) 90 ms, forced layout 32 ms',
        'Promise.then (markdown-Cd34.js) 60 ms',
        'IntersectionObserver.callback 20 ms',
      ],
    });
  });

  it('leaves out what a frame does not say', () => {
    expect(describeEntry(frame({ styleAndLayoutStart: 0, scripts: [] }))).toEqual({ kind: 'frame', durationMs: 400 });
  });

  it('reports a long task as a task', () => {
    expect(describeEntry({ entryType: 'longtask', startTime: 0, duration: 230 } as PerformanceEntry)).toEqual({ kind: 'task', durationMs: 230 });
  });
});

describe('installFreezeWatch', () => {
  it('watches long animation frames and reports the slow ones', () => {
    const { made, deliver } = stubObserver(['longtask', 'long-animation-frame']);
    const report = vi.fn();
    installFreezeWatch(report);
    expect(made[0].observed).toEqual([{ type: 'long-animation-frame' }]);

    deliver([frame({ duration: FREEZE_MS - 1 }), frame({ duration: 250 })]);
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ kind: 'frame', durationMs: 250 });
  });

  it('falls back to long tasks where frames cannot be timed', () => {
    const { made } = stubObserver(['longtask']);
    installFreezeWatch(vi.fn());
    expect(made[0].observed).toEqual([{ type: 'longtask' }]);
  });

  it('does nothing where neither can be timed', () => {
    const { made } = stubObserver(['paint']);
    const stop = installFreezeWatch(vi.fn());
    expect(made).toHaveLength(0);
    expect(stop).not.toThrow();
  });

  it('stops watching when uninstalled', () => {
    const { made } = stubObserver(['long-animation-frame']);
    const stop = installFreezeWatch(vi.fn());
    stop();
    expect(made[0].disconnected).toBe(true);
  });
});
