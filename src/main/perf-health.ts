/**
 * Health line: every few minutes, one line in the performance log
 * (perf-log.ts) summing up the period, so slow build-up over a long day
 * (memory, process launches, freezes) shows:
 *
 *   last 10 min: event loop delay p50 1 ms, p99 38 ms, max 310 ms;
 *   freezes: main 3 (640 ms), window 1; process launches 42 (1.9 s blocking,
 *   slowest git worktree 120 ms); CPU main 2%, pages 4%, gpu 1%, other 0%;
 *   memory main 210 MB, pages 480 MB, gpu 120 MB, other 90 MB;
 *   conversations 5 (2 asleep), terminals 2
 *
 * It uses the stall timer's numbers (freeze-log.ts) rather than a timer of
 * its own. (Node's event-loop utilization isn't used: Electron runs Node's
 * loop inside Chromium's, so it doesn't measure the main thread.) Agents' own processes aren't Electron's, so their CPU and memory
 * aren't in it; how many conversations are open (agents running or asleep)
 * is.
 */
import type { ProcessMetric } from 'electron';
import type { FreezeStats } from './freeze-log.js';
import { perfLine } from './perf-log.js';

/** Time between health lines. */
export const HEALTH_MS = 10 * 60_000;
/** The first comes sooner, to show how the app settled after starting. */
export const FIRST_HEALTH_MS = 60_000;

/** The Electron processes, grouped as the line shows them. */
const GROUPS: Record<string, string> = { Browser: 'main', Tab: 'pages', GPU: 'gpu' };
const GROUP_ORDER = ['main', 'pages', 'gpu', 'other'];

export interface HealthInput {
  minutes: number;
  freeze: FreezeStats;
  metrics: Pick<ProcessMetric, 'type' | 'cpu' | 'memory'>[];
  /** Open conversations, and of those, how many are asleep (no agent
   *  process running). */
  conversations: number;
  asleep: number;
  terminals: number;
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export function formatHealth(h: HealthInput): string {
  const parts: string[] = [];

  if (h.freeze.loopDelay) {
    const d = h.freeze.loopDelay;
    parts.push(`event loop delay p50 ${Math.round(d.p50)} ms, p99 ${Math.round(d.p99)} ms, max ${Math.round(d.max)} ms`);
  }

  const f = h.freeze;
  parts.push(`freezes: main ${f.stalls}${f.stalls > 0 ? ` (${ms(f.stallMs)})` : ''}, window ${f.slowFrames}`);
  parts.push(`process launches ${f.launches}${f.launches > 0
    ? ` (${ms(f.launchMs)} blocking${f.slowestLaunch ? `, slowest ${f.slowestLaunch.name} ${ms(f.slowestLaunch.ms)}` : ''})`
    : ''}`);

  if (h.metrics.length > 0) {
    const cpu = new Map<string, number>();
    const mem = new Map<string, number>();
    for (const m of h.metrics) {
      const group = GROUPS[m.type] ?? 'other';
      cpu.set(group, (cpu.get(group) ?? 0) + (m.cpu?.percentCPUUsage ?? 0));
      // Kilobytes, as Electron reports them. Private bytes (Windows) is what
      // Task Manager shows as a process's memory; the working set elsewhere.
      mem.set(group, (mem.get(group) ?? 0) + (m.memory?.privateBytes ?? m.memory?.workingSetSize ?? 0));
    }
    const groups = GROUP_ORDER.filter((g) => cpu.has(g));
    parts.push(`CPU ${groups.map((g) => `${g} ${Math.round(cpu.get(g)!)}%`).join(', ')}`);
    parts.push(`memory ${groups.map((g) => `${g} ${Math.round(mem.get(g)! / 1024)} MB`).join(', ')}`);
  }

  parts.push(`conversations ${h.conversations}${h.asleep > 0 ? ` (${h.asleep} asleep)` : ''}, terminals ${h.terminals}`);
  return `last ${h.minutes} min: ${parts.join('; ')}`;
}

export interface HealthSources {
  takeFreezeStats: () => FreezeStats;
  getAppMetrics: () => HealthInput['metrics'];
  counts: () => Pick<HealthInput, 'conversations' | 'asleep' | 'terminals'>;
}

/** Write a health line now and then. Returns a function that stops it. */
export function startHealthLog(
  sources: HealthSources,
  { write = (line: string) => perfLine('health', line), everyMs = HEALTH_MS, firstMs = FIRST_HEALTH_MS } = {},
): () => void {
  let lastAt = performance.now();
  // Every period starts now. CPU use is measured since the previous call, and
  // the freeze totals so far cover the launch before the app was ready,
  // which the freeze lines already show one by one.
  sources.getAppMetrics();
  sources.takeFreezeStats();

  const report = () => {
    const now = performance.now();
    const minutes = Math.max(1, Math.round((now - lastAt) / 60_000));
    lastAt = now;
    write(formatHealth({
      minutes,
      freeze: sources.takeFreezeStats(),
      metrics: sources.getAppMetrics(),
      ...sources.counts(),
    }));
  };

  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    report();
    interval = setInterval(report, everyMs);
    (interval as { unref?: () => void }).unref?.();
  }, firstMs);
  (first as { unref?: () => void }).unref?.();
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
