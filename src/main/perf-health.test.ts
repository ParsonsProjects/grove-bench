import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatHealth, startHealthLog, type HealthInput } from './perf-health.js';
import type { FreezeStats } from './freeze-log.js';

const quiet: FreezeStats = { stalls: 0, stallMs: 0, slowFrames: 0, launches: 0, launchMs: 0, slowestLaunch: null, loopDelay: null };

const metric = (type: string, cpu: number, kb: number, privateKb?: number) =>
  ({ type, cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: 0 }, memory: { workingSetSize: kb, peakWorkingSetSize: kb, ...(privateKb !== undefined ? { privateBytes: privateKb } : {}) } }) as HealthInput['metrics'][number];

afterEach(() => {
  vi.useRealTimers();
});

describe('formatHealth', () => {
  it('sums up the period in one line', () => {
    const line = formatHealth({
      minutes: 10,
      freeze: {
        stalls: 3, stallMs: 640, slowFrames: 1,
        launches: 42, launchMs: 1900, slowestLaunch: { name: 'git worktree', ms: 120.4 },
        loopDelay: { p50: 1.2, p99: 38, max: 310 },
      },
      metrics: [
        metric('Browser', 1.6, 215_040, 209_920),
        metric('Tab', 3, 300_000, 290_000),
        metric('Tab', 1, 200_000, 201_520),
        metric('GPU', 0.8, 122_880, 122_880),
        metric('Utility', 0.2, 50_000, 46_080),
        metric('Utility', 0, 50_000, 46_080),
      ],
      conversations: 5,
      asleep: 2,
      terminals: 2,
    });
    expect(line).toBe('last 10 min: event loop delay p50 1 ms, p99 38 ms, max 310 ms; '
      + 'freezes: main 3 (640 ms), window 1; process launches 42 (1.9 s blocking, slowest git worktree 120 ms); '
      + 'CPU main 2%, pages 4%, gpu 1%, other 0%; memory main 205 MB, pages 480 MB, gpu 120 MB, other 90 MB; conversations 5 (2 asleep), terminals 2');
  });

  it('uses the working set where private bytes are not reported', () => {
    const line = formatHealth({ minutes: 1, freeze: quiet, metrics: [metric('Browser', 0, 102_400)], conversations: 1, asleep: 0, terminals: 0 });
    expect(line).toBe('last 1 min: freezes: main 0, window 0; process launches 0; CPU main 0%; memory main 100 MB; conversations 1, terminals 0');
  });
});

describe('startHealthLog', () => {
  it('writes the first line after a minute, then every period, until stopped', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const getAppMetrics = vi.fn(() => [metric('Browser', 1, 1024)]);
    const takeFreezeStats = vi.fn(() => quiet);
    const stop = startHealthLog(
      { takeFreezeStats, getAppMetrics, counts: () => ({ conversations: 1, asleep: 0, terminals: 0 }) },
      { write: (l) => lines.push(l), firstMs: 60_000, everyMs: 600_000 },
    );
    // Called once at the start, so the first line covers only its period.
    expect(getAppMetrics).toHaveBeenCalledOnce();
    expect(takeFreezeStats).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(59_999);
    expect(lines).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^last \d+ min: .*conversations 1, terminals 0$/);

    vi.advanceTimersByTime(600_000);
    expect(lines).toHaveLength(2);
    expect(takeFreezeStats).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(600_000);
    expect(lines).toHaveLength(2);
  });
});
