/**
 * The whole PC's load, for the health line (perf-health.ts): its CPU, the
 * threads waiting for one, its disks, its free memory and paging, over the
 * period the line covers.
 *
 * The performance log of 28 Oct to 3 Nov (21 agents at the busiest, on a
 * 64 GB PC with AVG) had launches of seconds, up to 50 s, appends of a few
 * hundred bytes to an event log taking up to 46 s, and most main-process
 * stalls using a fraction of their length in CPU: the app was waiting. On
 * what, the log couldn't say. Electron's metrics cover only its own
 * processes, and the agents' CPU isn't measured. These counters tell the
 * causes apart: every core busy (the agents' builds and tests) shows as CPU
 * near 100% with threads queueing for it; a busy or slow disk as its busy
 * time and its time per transfer; memory running out as free memory falling
 * and pages read back in. When none of those is high and launches and
 * writes are still slow, what is left is something checking each file and
 * launch, such as an antivirus.
 *
 * typeperf samples them every SAMPLE_SEC through the period, in one run
 * started as the period starts, in the agent host (runInAgentHost,
 * hostOnly), as the process list is (process-memory.ts). It stops SLACK_MS
 * before the period ends, so a slow start (typeperf took up to 21 s to start
 * on that PC) still has it done for the line, which waits for it as it waits
 * for the process list. Only in the agent host: a command that runs for ten
 * minutes doesn't belong in the git host, whose commands are short, so once
 * the agent host has given up the line goes without. The counters are the
 * system's totals (_Total), whose instances don't change while it runs
 * (typeperf expands an instance wildcard only when it starts). Their names
 * are English: on a Windows in another language typeperf turns them down,
 * and the line leaves them out.
 */
import os from 'node:os';
import { logger } from './logger.js';
import { agentHostGaveUp } from './process-host.js';
import { runInAgentHost } from './process-host-run.js';
import { counterValue, excerpt, quotedFields, typeperfOutput, TYPEPERF_TIMEOUT_MS, type RunTypeperf } from './process-memory.js';

/** Seconds between samples. */
export const SAMPLE_SEC = 15;
/** How long before the period ends the samples stop. */
export const SLACK_MS = 30_000;

/** The counters read, by what they're read for. */
export const SYSTEM_COUNTERS = {
  /** Busy time of all the cores, %. */
  cpu: '\\Processor(_Total)\\% Processor Time',
  /** The part of it in kernel mode, where file system filters (an
   *  antivirus's) and drivers run, %. */
  kernel: '\\Processor(_Total)\\% Privileged Time',
  /** Threads ready to run but waiting for a core, at the sample. */
  queue: '\\System\\Processor Queue Length',
  /** Time the disks were idle, %. */
  diskIdle: '\\PhysicalDisk(_Total)\\% Idle Time',
  /** Seconds a disk transfer took. */
  diskSec: '\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer',
  /** Memory free for use, MB. */
  freeMB: '\\Memory\\Available MBytes',
  /** Pages read from disk to resolve hard page faults, per second. */
  pagesIn: '\\Memory\\Pages Input/sec',
} as const;

type CounterKey = keyof typeof SYSTEM_COUNTERS;

/** typeperf's arguments: `samples` samples of each counter, SAMPLE_SEC apart. */
export function systemCounterArgs(samples: number): string[] {
  return [...Object.values(SYSTEM_COUNTERS), '-si', String(SAMPLE_SEC), '-sc', String(samples)];
}

/** A counter's average and highest sample over the period. */
export interface Spread {
  avg: number;
  max: number;
}

/** The PC's load over a period. A counter with no readable sample is left out. */
export interface SystemLoad {
  samples: number;
  /** Logical processors, to read `queue` against. */
  cores: number;
  /** Busy time of all the cores, %. */
  cpu?: Spread;
  /** The part of `cpu` in kernel mode, %. */
  kernel?: Spread;
  /** Threads waiting for a core. */
  queue?: Spread;
  /** Busy time of the disks, %. */
  diskBusy?: Spread;
  /** Milliseconds a disk transfer took. */
  diskMs?: Spread;
  /** The least memory free at a sample, in bytes. */
  freeBytes?: number;
  /** Pages read back from disk, per second. */
  pagesIn?: Spread;
  /** Sample lines left out because their values didn't line up with
   *  typeperf's header, when there were any (parseSystemCounters()). */
  leftOut?: number;
}

/** A period whose every sample line was left out (parseSystemCounters()):
 *  the health line says so rather than leave the system part out unexplained. */
export interface SystemSkipped {
  skipped: 'misaligned';
  lines: number;
}

/** A counter's path in typeperf's header, without the computer's name:
 *  \\HOST\Memory\Available MBytes is \Memory\Available MBytes. */
const COUNTER_PATH = /^\\\\[^\\]*(\\.+)$/;
const LINE_BREAK = /\r?\n/;
const BY_PATH = new Map(Object.entries(SYSTEM_COUNTERS).map(([key, p]) => [p.toLowerCase(), key as CounterKey]));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Shares of time, which stray a little past 0 and 100 and are clamped back. */
const PERCENTS: ReadonlySet<CounterKey> = new Set(['cpu', 'kernel', 'diskIdle']);

function spread(values: number[], map: (v: number) => number = (v) => v): Spread | undefined {
  if (values.length === 0) return undefined;
  const mapped = values.map(map);
  return { avg: mapped.reduce((n, v) => n + v, 0) / mapped.length, max: Math.max(...mapped) };
}

/** What parseSystemCounters() read. */
export interface ParsedSystemCounters {
  /** The load, or null when no line held a sample of any of the counters. */
  load: Omit<SystemLoad, 'cores' | 'leftOut'> | null;
  /** The sample lines left out because their values didn't line up with the
   *  header: how many, and the header with the first of them. */
  misaligned?: { lines: number; example: string };
}

/** A sample's time, which typeperf prints before its values: a date and a
 *  time ("11/04/2026 15:27:41.288"), never a number. */
const isSampleTime = (field: string) => field.includes(':') && !Number.isFinite(counterValue(field));

/**
 * The load from typeperf's CSV output (systemCounterArgs()): a header of
 * counter paths, then a line of values per sample, each starting with its
 * time. Values are matched to the header from that time on, and a line
 * whose values then don't fit the header is left out and counted.
 *
 * On 4 to 6 Nov, 16 of 90 runs on one PC gave lines with one field more than
 * their header, which read by position showed each counter the value of the
 * one before it (disk idle % as ms per transfer, free MB as pages paged in).
 * Their raw output wasn't kept, so the cause is unknown: a field before the
 * time, which is read correctly here, or a header without its first counter,
 * which is left out, as there is no telling which counter is missing.
 * measureSystem() notes the first such line in the app log.
 *
 * A blank value (the counter couldn't be read that time) is skipped, and so
 * is a negative one, which none of these counters can have (PDH gives one
 * for a disk's time per transfer now and then); shares of time are clamped
 * to 0 to 100 instead.
 */
export function parseSystemCounters(stdout: string): ParsedSystemCounters {
  const lines = stdout.split(LINE_BREAK);
  const headerAt = lines.findIndex((l) => l.startsWith('"(PDH-CSV'));
  if (headerAt < 0) return { load: null };
  const header = quotedFields(lines[headerAt]);
  const columns = new Map<number, CounterKey>();
  for (let i = 1; i < header.length; i++) {
    const key = BY_PATH.get(COUNTER_PATH.exec(header[i])?.[1].toLowerCase() ?? '');
    if (key) columns.set(i, key);
  }
  if (columns.size === 0) return { load: null };

  const values = new Map<CounterKey, number[]>();
  let samples = 0;
  let misaligned: ParsedSystemCounters['misaligned'];
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.startsWith('"')) continue;
    const fields = quotedFields(line);
    // Where the time is, the header's first field is.
    const at = fields.findIndex(isSampleTime);
    if (at < 0 || fields.length - at !== header.length) {
      misaligned = { lines: (misaligned?.lines ?? 0) + 1, example: misaligned?.example ?? `${lines[headerAt].slice(0, 300)} / ${line.slice(0, 300)}` };
      continue;
    }
    let read = false;
    for (const [i, key] of columns) {
      const v = counterValue(fields[at + i]);
      if (!Number.isFinite(v) || (v < 0 && !PERCENTS.has(key))) continue;
      read = true;
      const list = values.get(key) ?? [];
      list.push(v);
      values.set(key, list);
    }
    if (read) samples++;
  }
  const withMisaligned = misaligned ? { misaligned } : {};
  if (samples === 0) return { load: null, ...withMisaligned };

  const of = (key: CounterKey) => values.get(key) ?? [];
  const free = of('freeMB');
  const load: NonNullable<ParsedSystemCounters['load']> = {
    samples,
    cpu: spread(of('cpu'), (v) => clamp(v, 0, 100)),
    kernel: spread(of('kernel'), (v) => clamp(v, 0, 100)),
    queue: spread(of('queue')),
    diskBusy: spread(of('diskIdle'), (v) => clamp(100 - v, 0, 100)),
    diskMs: spread(of('diskSec'), (v) => v * 1000),
    freeBytes: free.length > 0 ? Math.min(...free) * 1024 * 1024 : undefined,
    pagesIn: spread(of('pagesIn')),
  };
  for (const key of Object.keys(load) as (keyof typeof load)[]) {
    if (load[key] === undefined) delete load[key];
  }
  return { load, ...withMisaligned };
}

export interface MeasureSystemOptions {
  /** Runs typeperf; by default in the agent host. */
  run?: RunTypeperf;
  /** Whether the agent host has given up for good (agentHostGaveUp). */
  gaveUp?: () => boolean;
  cores?: number;
  platform?: NodeJS.Platform;
  /** Where the first failure is noted; later ones aren't. */
  note?: (line: string) => void;
}

let notedFailure = false;
let notedMisaligned = false;
/** Where a note goes: the app log, unless the caller says. */
const note = (opts: MeasureSystemOptions) => opts.note ?? ((line: string) => logger.info(line));

/**
 * Sample the PC's load through the next `windowMs`, for the line at its end.
 * Skipped when every sample line was left out for not lining up with the
 * header (noted once in the app log, not as a failure). Null on any platform
 * but Windows, once the agent host has given up, for a period too short to
 * sample, and when typeperf fails, times out or prints no sample. Never
 * throws.
 */
export async function measureSystem(windowMs: number, opts: MeasureSystemOptions = {}): Promise<SystemLoad | SystemSkipped | null> {
  if ((opts.platform ?? process.platform) !== 'win32') return null;
  if ((opts.gaveUp ?? agentHostGaveUp)()) return null;
  const samples = Math.floor((windowMs - SLACK_MS) / (SAMPLE_SEC * 1000));
  if (samples < 1) return null;
  try {
    const { output } = await typeperfOutput(opts.run ?? runInAgentHost, systemCounterArgs(samples), samples * SAMPLE_SEC * 1000 + TYPEPERF_TIMEOUT_MS);
    const { load, misaligned } = parseSystemCounters(output);
    if (misaligned && !notedMisaligned) {
      notedMisaligned = true;
      note(opts)(`[perf-system] typeperf printed ${misaligned.lines} sample line(s) whose values don't line up with its header, so they were left out of the health line; noted only here. Header / first such line: ${misaligned.example}`);
    }
    if (!load) {
      // Not a failure: the health line says so, and the note above has why.
      if (misaligned) return { skipped: 'misaligned', lines: misaligned.lines };
      throw new Error(`no sample in its output: ${excerpt(output) || 'none'}`);
    }
    return { ...load, ...(misaligned ? { leftOut: misaligned.lines } : {}), cores: opts.cores ?? os.availableParallelism() };
  } catch (e) {
    if (!notedFailure) {
      notedFailure = true;
      note(opts)(`[perf-system] Couldn't sample the PC's load with typeperf, so the health line leaves it out: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

/** Forget what was noted. */
export function resetForTests(): void {
  notedFailure = false;
  notedMisaligned = false;
}
