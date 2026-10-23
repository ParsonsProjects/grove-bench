/**
 * Health line: every few minutes, one line in the performance log
 * (perf-log.ts) summing up the period, so slow build-up over a long day
 * (memory, process launches, freezes) shows:
 *
 *   last 10 min: event loop delay p50 1 ms, p99 38 ms, max 310 ms;
 *   freezes: main 3 (640 ms), window 1; process launches 42 (1.9 s blocking,
 *   slowest git worktree 120 ms); agent output 12 MB, 4210 events (12.5 s);
 *   CPU main 2%, pages 4%, gpu 1%, other 0%;
 *   memory main 210 MB, pages 480 MB, gpu 120 MB, other 90 MB;
 *   agents 3, 2.0 GB: node.exe 9 (1.2 GB), claude.exe 3 (800 MB),
 *   conhost.exe 3 (40 MB), cmd.exe 4 (25 MB); dev server 900 MB: node.exe 2
 *   (880 MB), esbuild.exe 1 (15 MB), cmd.exe 1 (5.0 MB);
 *   conversations 5 (2 asleep), terminals 2
 *
 * followed by the largest processes under the agents, each with its thread
 * and the executables above it:
 *
 *   largest agent processes: node.exe 700 MB (pid 4312, thread 1a2b3c4d,
 *   under claude.exe > cmd.exe > node.exe), claude.exe 310 MB (pid 2210,
 *   thread 1a2b3c4d), ...
 *
 * It uses the stall timer's numbers (freeze-log.ts) rather than a timer of
 * its own. (Node's event-loop utilization isn't used: Electron runs Node's
 * loop inside Chromium's, so it doesn't measure the main thread.) CPU and
 * memory are for Electron's own processes (app.getAppMetrics()). The agents
 * aren't Electron's: on Windows their memory is summed apart
 * (process-memory.ts), every process under each thread's agent by
 * executable, and in dev mode the npm and Vite processes above the app too.
 * Listing them takes typeperf a second or two in the agent host, so the
 * line waits for it, up to PROCESSES_WAIT_MS, and is written without them
 * when they can't be had (or on other platforms). A list that didn't hold
 * together is skipped, and the line says so: "agents: sample inconsistent,
 * skipped". Their CPU isn't measured.
 */
import type { ProcessMetric } from 'electron';
import { formatBytes, type FreezeStats } from './freeze-log.js';
import { perfLine } from './perf-log.js';
import type { AgentTreeProcess, ExeTotal, ProcessMemory, SkippedSample } from './process-memory.js';
import { within } from './within.js';

/** Time between health lines. */
export const HEALTH_MS = 10 * 60_000;
/** The first comes sooner, to show how the app settled after starting. */
export const FIRST_HEALTH_MS = 60_000;
/** Longest the line waits for the agents' processes to be listed. */
export const PROCESSES_WAIT_MS = 45_000;
/** Executables named in a list of processes; the rest are summed as other. */
const NAMED_EXES = 5;

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
  /** The agents' processes, and the dev server's (Windows only), or a
   *  sample of them that was skipped. */
  processes?: ProcessMemory | SkippedSample | null;
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const total = (totals: ExeTotal[]) => totals.reduce((n, t) => n + t.bytes, 0);

/** node.exe 64 (5.2 GB), claude.exe 21 (3.9 GB), other 12 (400 MB) */
function exeList(totals: ExeTotal[]): string {
  const named = totals.length > NAMED_EXES + 1 ? totals.slice(0, NAMED_EXES) : totals;
  const rest = totals.slice(named.length);
  const items = named.map((t) => `${t.name} ${t.count} (${formatBytes(t.bytes)})`);
  if (rest.length > 0) items.push(`other ${rest.reduce((n, t) => n + t.count, 0)} (${formatBytes(total(rest))})`);
  return items.join(', ');
}

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
  const out = f.agentOutput;
  if (out.events > 0 || out.chars > 0) {
    parts.push(`agent output ${formatBytes(out.chars)}, ${out.events} events (${ms(out.ms)})`);
  }

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

  if (h.processes && 'skipped' in h.processes) {
    parts.push('agents: sample inconsistent, skipped');
  } else if (h.processes) {
    const a = h.processes.agents;
    parts.push(`agents ${a.agents}${a.untracked > 0 ? ` + ${a.untracked} not a thread's` : ''}${a.byExe.length > 0
      ? `, ${formatBytes(total(a.byExe))}: ${exeList(a.byExe)}`
      : ''}`);
    const dev = h.processes.devServer;
    if (dev && dev.length > 0) parts.push(`dev server ${formatBytes(total(dev))}: ${exeList(dev)}`);
  }

  parts.push(`conversations ${h.conversations}${h.asleep > 0 ? ` (${h.asleep} asleep)` : ''}, terminals ${h.terminals}`);
  return `last ${h.minutes} min: ${parts.join('; ')}`;
}

/** The largest processes under the agents, each with its thread and the
 *  executables above it. Names only: no command lines, which can hold tokens. */
export function formatLargest(largest: AgentTreeProcess[]): string {
  return `largest agent processes: ${largest.map((p) => {
    const where = [`pid ${p.pid}`, p.thread === null ? "not a thread's" : `thread ${p.thread}`];
    if (p.under.length > 0) where.push(`under ${p.under.join(' > ')}`);
    return `${p.name} ${formatBytes(p.bytes)} (${where.join(', ')})`;
  }).join(', ')}`;
}

export interface HealthSources {
  takeFreezeStats: () => FreezeStats;
  getAppMetrics: () => HealthInput['metrics'];
  counts: () => Pick<HealthInput, 'conversations' | 'asleep' | 'terminals'>;
  /** The agents' processes (process-memory.ts). Null, a failure or a wait
   *  past PROCESSES_WAIT_MS leaves them out of the line. */
  processes?: () => Promise<ProcessMemory | SkippedSample | null>;
}

/** Write a health line now and then. Returns a function that stops it. */
export function startHealthLog(
  sources: HealthSources,
  {
    write = (line: string) => perfLine('health', line),
    everyMs = HEALTH_MS,
    firstMs = FIRST_HEALTH_MS,
    processesWaitMs = PROCESSES_WAIT_MS,
  } = {},
): () => void {
  let stopped = false;
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
    const input: HealthInput = {
      minutes,
      freeze: sources.takeFreezeStats(),
      metrics: sources.getAppMetrics(),
      ...sources.counts(),
    };
    let measuring: Promise<ProcessMemory | SkippedSample | null> | undefined;
    try {
      measuring = sources.processes?.();
    } catch { /* left out */ }
    if (!measuring) {
      write(formatHealth(input));
      return;
    }
    // The rest of the line is as of now; the processes follow within seconds,
    // or are left out if measuring them fails or takes too long.
    let measured: ProcessMemory | SkippedSample | null = null;
    void within(measuring.then((m) => { measured = m; }), processesWaitMs).catch(() => false).then((inTime) => {
      if (stopped) return;
      const processes = inTime ? measured : null;
      write(formatHealth({ ...input, processes }));
      if (processes && 'agents' in processes && processes.agents.largest.length > 0) write(formatLargest(processes.agents.largest));
    });
  };

  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    report();
    interval = setInterval(report, everyMs);
    (interval as { unref?: () => void }).unref?.();
  }, firstMs);
  (first as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
