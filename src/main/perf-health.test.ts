import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatHealth, formatLargest, startHealthLog, type HealthInput } from './perf-health.js';
import type { FreezeStats } from './freeze-log.js';
import type { ProcessMemory, SkippedSample } from './process-memory.js';

const noOutput = { events: 0, chars: 0, ms: 0 };
const quiet: FreezeStats = { stalls: 0, stallMs: 0, slowFrames: 0, launches: 0, launchMs: 0, slowestLaunch: null, agentOutput: noOutput, loopDelay: null };

const metric = (type: string, cpu: number, kb: number, privateKb?: number) =>
  ({ type, cpu: { percentCPUUsage: cpu, idleWakeupsPerSecond: 0 }, memory: { workingSetSize: kb, peakWorkingSetSize: kb, ...(privateKb !== undefined ? { privateBytes: privateKb } : {}) } }) as HealthInput['metrics'][number];

const MB = 1024 * 1024;
/** A sample of the agents' processes that didn't hold together (process-memory.ts). */
const SKIPPED: SkippedSample = { skipped: 'inconsistent' };

/** A sample of Process V2: every process as listed. */
const processes: Extract<ProcessMemory, { counters: 'Process V2' }> = {
  counters: 'Process V2',
  agents: {
    agents: 21,
    untracked: 2,
    byExe: [
      { name: 'node.exe', count: 64, bytes: 5324 * MB },
      { name: 'claude.exe', count: 23, bytes: 3994 * MB },
      { name: 'conhost.exe', count: 23, bytes: 150 * MB },
      { name: 'bash.exe', count: 6, bytes: 60 * MB },
      { name: 'cmd.exe', count: 30, bytes: 45 * MB },
      { name: 'esbuild.exe', count: 2, bytes: 30 * MB },
      { name: 'rg.exe', count: 1, bytes: 10 * MB },
    ],
    largest: [
      { name: 'node.exe', pid: 4312, bytes: 1229 * MB, thread: '1a2b3c4d', under: ['claude.exe', 'cmd.exe', 'node.exe'] },
      { name: 'claude.exe', pid: 2210, bytes: 600 * MB, thread: '1a2b3c4d', under: [] },
      { name: 'node.exe', pid: 5120, bytes: 410 * MB, thread: null, under: ['claude.exe'] },
    ],
  },
  devServer: [
    { name: 'node.exe', count: 2, bytes: 1100 * MB },
    { name: 'esbuild.exe', count: 1, bytes: 30 * MB },
  ],
};

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
        agentOutput: { events: 4210, chars: 12.3 * 1024 * 1024, ms: 12_480 },
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
      + 'agent output 12 MB, 4210 events (12.5 s); '
      + 'CPU main 2%, pages 4%, gpu 1%, other 0%; memory main 205 MB, pages 480 MB, gpu 120 MB, other 90 MB; conversations 5 (2 asleep), terminals 2');
  });

  it("adds the agents' processes by executable, and the dev server's", () => {
    const line = formatHealth({ minutes: 10, freeze: quiet, metrics: [], conversations: 23, asleep: 0, terminals: 0, processes });
    expect(line).toBe('last 10 min: freezes: main 0, window 0; process launches 0; '
      + "agents 21 + 2 not a thread's, 9.4 GB: node.exe 64 (5.2 GB), claude.exe 23 (3.9 GB), conhost.exe 23 (150 MB), "
      + 'bash.exe 6 (60 MB), cmd.exe 30 (45 MB), other 3 (40 MB); '
      + 'dev server 1.1 GB: node.exe 2 (1.1 GB), esbuild.exe 1 (30 MB); conversations 23, terminals 0');
  });

  it('names a sixth executable rather than call it other', () => {
    const six = { ...processes.agents, untracked: 0, byExe: processes.agents.byExe.slice(0, 6) };
    const line = formatHealth({ minutes: 10, freeze: quiet, metrics: [], conversations: 21, asleep: 0, terminals: 0, processes: { counters: 'Process V2', agents: six, devServer: null } });
    expect(line).toContain('cmd.exe 30 (45 MB), esbuild.exe 2 (30 MB); conversations');
  });

  it('says when no agent is running, and leaves out what could not be measured', () => {
    const none: ProcessMemory = { counters: 'Process V2', agents: { agents: 0, untracked: 0, byExe: [], largest: [] }, devServer: [] };
    expect(formatHealth({ minutes: 1, freeze: quiet, metrics: [], conversations: 3, asleep: 3, terminals: 0, processes: none }))
      .toBe('last 1 min: freezes: main 0, window 0; process launches 0; agents 0; conversations 3 (3 asleep), terminals 0');
    expect(formatHealth({ minutes: 1, freeze: quiet, metrics: [], conversations: 3, asleep: 0, terminals: 0, processes: null }))
      .toBe('last 1 min: freezes: main 0, window 0; process launches 0; conversations 3, terminals 0');
  });

  it('gives only the agents themselves from the legacy Process counters, and says so', () => {
    const legacy = (agents: number, ownBytes: number): ProcessMemory => ({ counters: 'Process', agents: { agents, ownBytes }, devServer: null });
    expect(formatHealth({ minutes: 10, freeze: quiet, metrics: [], conversations: 6, asleep: 1, terminals: 0, processes: legacy(5, 1750 * MB) }))
      .toBe('last 10 min: freezes: main 0, window 0; process launches 0; '
        + 'agents 5, their own processes 1.7 GB (legacy Process counters: what they started not listed); conversations 6 (1 asleep), terminals 0');
    expect(formatHealth({ minutes: 10, freeze: quiet, metrics: [], conversations: 1, asleep: 1, terminals: 0, processes: legacy(0, 0) }))
      .toContain('; agents 0 (legacy Process counters: what they started not listed); ');
  });

  it("says when the agents' sample didn't hold together, rather than show its numbers", () => {
    expect(formatHealth({ minutes: 10, freeze: quiet, metrics: [], conversations: 16, asleep: 0, terminals: 0, processes: SKIPPED }))
      .toBe('last 10 min: freezes: main 0, window 0; process launches 0; agents: sample inconsistent, skipped; conversations 16, terminals 0');
  });

  it('uses the working set where private bytes are not reported', () => {
    const line = formatHealth({ minutes: 1, freeze: quiet, metrics: [metric('Browser', 0, 102_400)], conversations: 1, asleep: 0, terminals: 0 });
    expect(line).toBe('last 1 min: freezes: main 0, window 0; process launches 0; CPU main 0%; memory main 100 MB; conversations 1, terminals 0');
  });
});

describe('formatLargest', () => {
  it('names each process, its thread and the executables above it', () => {
    expect(formatLargest(processes.agents.largest)).toBe('largest agent processes: '
      + 'node.exe 1.2 GB (pid 4312, thread 1a2b3c4d, under claude.exe > cmd.exe > node.exe), '
      + 'claude.exe 600 MB (pid 2210, thread 1a2b3c4d), '
      + "node.exe 410 MB (pid 5120, not a thread's, under claude.exe)");
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

  const sources = (measure: () => Promise<ProcessMemory | SkippedSample | null>) => ({
    takeFreezeStats: () => quiet,
    getAppMetrics: () => [metric('Browser', 1, 1024)],
    counts: () => ({ conversations: 23, asleep: 0, terminals: 0 }),
    processes: measure,
  });

  it("waits for the agents' processes, then writes the line and the largest of them", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let finish: (m: ProcessMemory) => void = () => {};
    startHealthLog(sources(() => new Promise((r) => { finish = r; })), { write: (l) => lines.push(l), firstMs: 1000, everyMs: 600_000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(0);
    finish(processes);
    await vi.advanceTimersByTimeAsync(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/; agents 21 \+ 2 not a thread's, 9\.4 GB: .*; dev server 1\.1 GB: .*; conversations 23, terminals 0$/);
    expect(lines[1]).toMatch(/^largest agent processes: node\.exe 1\.2 GB /);
  });

  it('writes no largest processes from the legacy Process counters, which can mix them up', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    startHealthLog(sources(async () => ({ counters: 'Process', agents: { agents: 2, ownBytes: 900 * MB }, devServer: null })),
      { write: (l) => lines.push(l), firstMs: 1000, everyMs: 600_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toEqual([expect.stringMatching(/; agents 2, their own processes 900 MB \(legacy Process counters: what they started not listed\); conversations 23, terminals 0$/)]);
  });

  it("writes only the line, saying so, for a sample that didn't hold together", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    startHealthLog(sources(async () => SKIPPED), { write: (l) => lines.push(l), firstMs: 1000, everyMs: 600_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toEqual([expect.stringMatching(/; agents: sample inconsistent, skipped; conversations 23, terminals 0$/)]);
  });

  it('writes the line without them when they fail, or take too long', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const measure = vi.fn<() => Promise<ProcessMemory | null>>()
      .mockRejectedValueOnce(new Error('typeperf failed'))
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(null);
    startHealthLog(sources(measure), { write: (l) => lines.push(l), firstMs: 1000, everyMs: 600_000, processesWaitMs: 45_000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/memory main 1 MB; conversations 23, terminals 0$/);

    await vi.advanceTimersByTimeAsync(600_000 + 44_999);
    expect(lines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(lines).toHaveLength(2);
    expect(lines[1]).not.toContain('agents');

    await vi.advanceTimersByTimeAsync(600_000);
    expect(lines).toHaveLength(3);
    expect(lines[2]).not.toContain('agents');
  });

  it('writes nothing for a measurement that finishes after it was stopped', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    let finish: (m: ProcessMemory) => void = () => {};
    const stop = startHealthLog(sources(() => new Promise((r) => { finish = r; })), { write: (l) => lines.push(l), firstMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    finish(processes);
    await vi.advanceTimersByTimeAsync(0);
    expect(lines).toHaveLength(0);
  });
});
