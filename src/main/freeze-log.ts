/**
 * Freeze log: notes in the performance log (perf-log.ts), and the app log,
 * when the app stopped responding, so a freeze someone reports can be traced to its
 * cause afterwards.
 *
 * Two places can freeze the whole window. The main process passes input to
 * the window, so while its event loop is blocked nothing responds; a timer
 * here that should run every TICK_MS notices when it ran late, and names
 * the IPC calls and process launches that ran meanwhile. And the window
 * itself can take long over a frame; it reports those frames (see
 * renderer/lib/freeze-watch.ts) and they are written here.
 *
 * Launching a process blocks the main process until the OS has created it,
 * which on Windows can take tens of milliseconds, so every launch is timed.
 * (git launches from the process host instead, and gh from the agent host:
 * process-host.ts.)
 *
 * A stall with nothing named used to be a mystery, so two more things are
 * named: synchronous work the app marks with timeWork (reading an event log,
 * execa's PATH search before a launch), and garbage collection pauses.
 *
 * Most stalls were still unnamed, and they grew with how busy the agents
 * were, so the agents' output is counted too: every chunk an agent writes
 * reaches the main process, where the agent SDK parses it and the session
 * hands on the events it holds (agent events: N from X of output, with the
 * time that took), and so are the file changes the worktree watchers see
 * during turns (turn-files.ts). And the process's CPU time over a stall is
 * named. That is every thread's, not the main thread's alone: Chromium's own
 * threads, V8's garbage collection helpers and libuv's pool doing file I/O
 * count too. So CPU far below the gap means the main process was waiting, on
 * the system, a disk or an antivirus; CPU near it means some thread was
 * busy, but doesn't show it was the main one.
 */
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import type { IpcMain, IpcMainEvent, PowerMonitor } from 'electron';
import type { FreezeReport } from '../shared/types.js';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';

/** How often the main-process timer runs. */
export const TICK_MS = 50;
/** Log a stall when the timer's runs are this far apart: the event loop
 *  was blocked for at least STALL_GAP_MS - TICK_MS (100 ms). */
export const STALL_GAP_MS = 150;
/** A gap this long is a system sleep the suspend event missed, not a freeze. */
const SLEEP_GAP_MS = 30_000;
/** At most this many freeze lines a minute, so a bad state can't flood the log. */
const MAX_LINES_PER_MINUTE = 30;
/** IPC calls, process launches, timed work and collections remembered, to
 *  name the ones that ran during a stall. (Messages from the window, which
 *  come in bursts, are counted by channel instead.) */
const RECENT = 32;
/** Shorter collections are left out: a stall is 100 ms or more, and V8's
 *  small young-generation collections run all the time. */
export const GC_MIN_MS = 10;

/** Something that ran on the main process: an IPC handler, a launch, a piece
 *  of work timed with timeWork, or a garbage collection. */
interface Activity {
  name: string;
  start: number;
  /** Time it held the main process (an IPC handler: until it returned or
   *  reached its first await; a launch: until the OS created the process). */
  ms: number;
}

/** The messages the window sent on one channel: how many, and the time
 *  their listeners took. */
interface ChannelMessages {
  count: number;
  ms: number;
}

/** A garbage collection, as Node's performance timeline reports it. */
export interface GcEntry {
  startTime: number;
  duration: number;
  /** perf_hooks.constants.NODE_PERFORMANCE_GC_*, when Node says. */
  kind?: number;
}

const GC_KINDS: Record<number, string> = {
  [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weak callbacks',
};

/** Totals since the last health line (see perf-health.ts). */
export interface FreezeStats {
  stalls: number;
  stallMs: number;
  slowFrames: number;
  launches: number;
  launchMs: number;
  slowestLaunch: { name: string; ms: number } | null;
  /** Agent output handled on the main process (see timeAgentOutput). */
  agentOutput: AgentOutput;
  /** How late the timer ran: the main process's event-loop delay, in ms.
   *  Null when it didn't run. */
  loopDelay: { p50: number; p99: number; max: number } | null;
}

/** Agents' output the main process handled: the events it gave, its size
 *  (in characters, about bytes for the JSON agents write) and how long
 *  handling it held the main process. */
export interface AgentOutput {
  events: number;
  chars: number;
  ms: number;
}

const emptyStats = (): Omit<FreezeStats, 'loopDelay' | 'agentOutput'> => ({ stalls: 0, stallMs: 0, slowFrames: 0, launches: 0, launchMs: 0, slowestLaunch: null });

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** A size for the logs, in bytes, KB, MB or GB: a whole number, but with
 *  one decimal place for MB and GB under 10 (1.3 MB, 12 MB, 2.0 GB).
 *  (Agents' output is counted in characters, about bytes for the JSON they
 *  write.) */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} bytes`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  const [n, unit] = bytes < GB ? [bytes / MB, 'MB'] : [bytes / GB, 'GB'];
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unit}`;
}

/** The nearest-rank percentile `p` (0 to 1) of ascending `sorted`. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

export interface FreezeLogOptions {
  /** Monotonic clock in ms. */
  now?: () => number;
  write?: (line: string) => void;
  /** CPU time the process has used so far, in ms (every thread's). When
   *  given, each stall line says how much was used during it. */
  cpuMs?: () => number;
}

/** The CPU time this process has used, in ms: every thread's, as
 *  process.cpuUsage counts it, not the main thread's alone. */
export function processCpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/** Shells a process may be launched through (`shell: true`); the command
 *  they run says more than the shell's name. */
const SHELLS = new Set(['cmd.exe', 'cmd', 'sh', 'bash', 'powershell.exe', 'pwsh.exe']);

/** A subcommand or a script's file name: one plain word, nothing that
 *  could be a path, a flag, a message or a token. */
const PLAIN_WORD = /^[a-z][\w.-]{0,30}$/i;
/** A shell command's program when it ends in an extension, which may be a
 *  path with spaces in it ("C:\Users\Jo Smith\...\claude.cmd auth"). */
const PROGRAM_WITH_EXTENSION = /^(.*?\.(?:exe|cmd|bat|com|ps1))(?=\s|$)/i;

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
const hasPath = (p: string) => /[\\/]/.test(p);

/**
 * How a launch is named in the log: the program, and its first argument when
 * that is a plain word (a git or gh subcommand) or a script's file name; for
 * a shell, the program and subcommand of the command it runs. Paths are cut
 * to their last part and anything else is left out, so a label can't carry
 * a user's name, a project folder or text.
 */
export function launchLabel(file: unknown, args: unknown): string {
  const name = typeof file === 'string' ? baseName(file) : 'process';
  const rest = Array.isArray(args) ? args.slice(1).filter((a): a is string => typeof a === 'string') : [];
  if (SHELLS.has(name.toLowerCase())) {
    const flag = rest.findIndex((a) => /^([/-]c|-command)$/i.test(a));
    const command = (flag >= 0 ? rest.slice(flag + 1).join(' ') : '').replace(/["']/g, '').trim();
    const withExtension = PROGRAM_WITH_EXTENSION.exec(command)?.[1];
    const program = withExtension ?? command.split(/\s+/)[0] ?? '';
    // A path without an extension may have been cut at a space: say nothing.
    if (!program || (!withExtension && hasPath(program))) return name;
    const next = command.slice(program.length).trim().split(/\s+/)[0] ?? '';
    return `${name}: ${baseName(program)}${PLAIN_WORD.test(next) ? ` ${next}` : ''}`;
  }
  const first = rest[0];
  if (!first || first.startsWith('-')) return name;
  const word = hasPath(first) ? baseName(first) : first;
  return PLAIN_WORD.test(word) ? `${name} ${word}` : name;
}

/** Freeze lines go to the performance log and the app log, where they sit
 *  beside what the app was doing at the time. */
function writeFreeze(line: string): void {
  perfLine('freeze', line);
  logger.warn(`[freeze] ${line}`);
}

export function createFreezeLog({ now = () => performance.now(), write = writeFreeze, cpuMs }: FreezeLogOptions = {}) {
  let lastTick = now();
  let lastCpu = cpuMs?.() ?? 0;
  let suspended = false;
  /** Agent output handled, and worktree changes the turn watchers saw, as
   *  running totals. A stall names what they grew by since the tick before
   *  it, the health line what they grew by since the last one. Plain
   *  counters, so counting costs next to nothing. */
  const agent: AgentOutput = { events: 0, chars: 0, ms: 0 };
  const agentAtTick: AgentOutput = { ...agent };
  const agentAtStats: AgentOutput = { ...agent };
  let worktreeChanges = 0;
  let worktreeChangesAtTick = 0;
  /** Messages the window sent without waiting (ipc.on) since the last tick,
   *  by channel. They come in bursts (typing or pasting in a terminal sends
   *  one a keystroke), so they are counted here rather than remembered with
   *  the IPC calls, where a burst queued behind a slow call would push that
   *  call out of the stall line. */
  let messages = new Map<string, ChannelMessages>();
  const ipcCalls: Activity[] = [];
  const launches: Activity[] = [];
  const work: Activity[] = [];
  const collections: Activity[] = [];
  /** Set by watchGc. Node reports a collection only once the code it paused
   *  has finished, after the tick that saw the stall, so with this on a stall
   *  is written at the next tick (or by flush). What else ran is put in the
   *  line when the stall is seen, before newer entries can push it out. */
  let gcWatched = false;
  let pendingStall: { line: string; from: number; t: number } | null = null;
  let stats = emptyStats();
  /** How late each tick ran since the last takeStats (about 12,000 for ten
   *  minutes); the health line's event-loop delay comes from these, so it
   *  needs no timer of its own. */
  let delays: number[] = [];
  let windowStart = now();
  let linesThisWindow = 0;
  let dropped = 0;

  function remember(list: Activity[], item: Activity): void {
    list.push(item);
    if (list.length > RECENT) list.shift();
  }

  function emit(line: string): void {
    const t = now();
    if (t - windowStart >= 60_000) {
      if (dropped > 0) write(`${dropped} more freezes in the last minute were not logged`);
      windowStart = t;
      linesThisWindow = 0;
      dropped = 0;
    }
    if (linesThisWindow >= MAX_LINES_PER_MINUTE) {
      dropped++;
      return;
    }
    linesThisWindow++;
    write(line);
  }

  /** The entries of `list` that started between `from` and `t`. */
  function during(list: Activity[], from: number, t: number): string {
    return list
      .filter((c) => c.start >= from - 1 && c.start <= t)
      .map((c) => `${c.name} (${Math.round(c.ms)} ms)`)
      .join(', ');
  }

  /** The messages in `sent` by channel, the costliest first:
   *  "pty:write ×120 (3 ms)". */
  function messageList(sent: Map<string, ChannelMessages>): string {
    return [...sent]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([channel, m]) => `${channel}${m.count > 1 ? ` ×${m.count}` : ''} (${Math.round(m.ms)} ms)`)
      .join(', ');
  }

  /** A stall from `from` to `t`, naming what ran during it, all but the
   *  garbage collection. `cpu` is the process's CPU time over it (all
   *  threads'), when measured; `sent` the messages the window sent,
   *  `output` and `changes` what the agents wrote and the worktree watchers
   *  saw meanwhile. */
  function describeStall(from: number, t: number, gap: number, cpu: number | undefined, sent: Map<string, ChannelMessages>, output: AgentOutput, changes: number): string {
    const ipc = during(ipcCalls, from, t);
    const messaged = messageList(sent);
    const launched = during(launches, from, t);
    const other = during(work, from, t);
    const agentEvents = output.events > 0 || output.chars > 0
      ? `agent events: ${output.events}${output.chars > 0 ? ` from ${formatBytes(output.chars)} of output (${Math.round(output.ms)} ms)` : ''}`
      : '';
    return `main process didn't run for ${Math.round(gap)} ms`
      + (cpu !== undefined ? ` (process CPU, all threads: ${Math.round(cpu)} ms)` : '')
      + (ipc ? `; IPC calls during it: ${ipc}` : '')
      + (messaged ? `; IPC messages during it: ${messaged}` : '')
      + (launched ? `; processes started: ${launched}` : '')
      + (other ? `; other work: ${other}` : '')
      + (agentEvents ? `; ${agentEvents}` : '')
      + (changes > 0 ? `; worktree file changes: ${changes}` : '');
  }

  /** Write the stall waiting for its garbage collections, if there is one. */
  function flush(): void {
    if (!pendingStall) return;
    const { line, from, t } = pendingStall;
    pendingStall = null;
    const gc = during(collections, from, t);
    emit(line + (gc ? `; garbage collection: ${gc}` : ''));
  }

  /** Run TICK_MS apart. Logs a stall when this run comes late. */
  function tick(): void {
    const t = now();
    flush();
    const gap = t - lastTick;
    lastTick = t;
    const cpu = cpuMs?.();
    const cpuUsed = cpu === undefined ? undefined : cpu - lastCpu;
    if (cpu !== undefined) lastCpu = cpu;
    const output: AgentOutput = {
      events: agent.events - agentAtTick.events,
      chars: agent.chars - agentAtTick.chars,
      ms: agent.ms - agentAtTick.ms,
    };
    Object.assign(agentAtTick, agent);
    const changes = worktreeChanges - worktreeChangesAtTick;
    worktreeChangesAtTick = worktreeChanges;
    const sent = messages;
    if (sent.size > 0) messages = new Map();
    if (suspended || gap >= SLEEP_GAP_MS) return;
    delays.push(Math.max(0, gap - TICK_MS));
    if (gap < STALL_GAP_MS) return;
    stats.stalls++;
    stats.stallMs += gap;
    const from = t - gap;
    const line = describeStall(from, t, gap, cpuUsed, sent, output, changes);
    if (gcWatched) pendingStall = { line, from, t };
    else emit(line);
  }

  /**
   * Hand a chunk of an agent's output on with `deliver`, timing what that
   * costs the main process: `deliver` itself (into the stream the agent SDK
   * reads) and the promise chain it sets off, the SDK parsing the chunk and
   * the session handling the events it held. That chain runs as microtasks
   * before the main process does anything else, so the time is taken in a
   * tick queued from a microtask, which Node runs once none is left.
   */
  function timeAgentOutput(chars: number, deliver: () => void): void {
    const start = now();
    agent.chars += chars;
    try {
      deliver();
    } finally {
      queueMicrotask(() => process.nextTick(() => { agent.ms += now() - start; }));
    }
  }

  /** Run `fn` and remember how long it held the main process, so a stall
   *  during it names it. For synchronous work: with an async `fn`, only the
   *  part before its first await is timed. `name` must not carry a user's
   *  text or paths (see launchLabel). */
  function timeWork<T>(name: string, fn: () => T): T {
    const start = now();
    try {
      return fn();
    } finally {
      remember(work, { name, start, ms: now() - start });
    }
  }

  /** Remember a garbage collection, if it's long enough to matter. */
  function noteGc(entry: GcEntry): void {
    if (entry.duration < GC_MIN_MS) return;
    const kind = entry.kind === undefined ? undefined : GC_KINDS[entry.kind];
    remember(collections, { name: kind ?? 'collection', start: entry.startTime, ms: entry.duration });
  }

  /** Name garbage collections in stall lines from now on. `observe` hands
   *  each collection to the callback (Node's PerformanceObserver by default). */
  function watchGc(observe: (onEntry: (entry: GcEntry) => void) => void = observeGcEntries): void {
    if (gcWatched) return;
    gcWatched = true;
    observe(noteGc);
  }

  /** Time every process launch from now on (all of them go through
   *  `ChildProcess.prototype.spawn`: spawn, execFile, execa). That method
   *  isn't documented, so where it's missing launches go untimed. */
  function timeProcessLaunches(proto: object): void {
    const target = proto as { spawn?: (this: unknown, options: unknown) => unknown };
    const original = target.spawn;
    if (typeof original !== 'function') return;
    target.spawn = function (this: unknown, options: unknown) {
      const start = now();
      try {
        return original.call(this, options);
      } finally {
        const ms = now() - start;
        const opts = (options ?? {}) as { file?: unknown; args?: unknown };
        const name = launchLabel(opts.file, opts.args);
        remember(launches, { name, start, ms });
        stats.launches++;
        stats.launchMs += ms;
        if (!stats.slowestLaunch || ms > stats.slowestLaunch.ms) stats.slowestLaunch = { name, ms };
      }
    };
  }

  /** Count a message a listener registered with `ipc.on` handled. */
  function noteMessage(channel: string, ms: number): void {
    const m = messages.get(channel);
    if (m) {
      m.count++;
      m.ms += ms;
    } else {
      messages.set(channel, { count: 1, ms });
    }
  }

  /** Time the synchronous part of every handler registered with
   *  `ipc.handle` from now on, and of every listener registered with
   *  `ipc.on` or `ipc.once` (messages the window sends without waiting: a
   *  prompt sent, a keystroke in a terminal, saved app state), so a stall
   *  can name the calls it covered, and the messages by channel. */
  function timeIpcHandlers(ipc: Pick<IpcMain, 'handle' | 'on' | 'once' | 'removeListener'>): void {
    const handle = ipc.handle.bind(ipc);
    ipc.handle = (channel: string, listener: Parameters<IpcMain['handle']>[1]) => handle(channel, (event, ...args) => {
      const start = now();
      try {
        return listener(event, ...args);
      } finally {
        remember(ipcCalls, { name: channel, start, ms: now() - start });
      }
    });
    type Listener = Parameters<IpcMain['on']>[1];
    const on = ipc.on.bind(ipc);
    const removeListener = ipc.removeListener.bind(ipc);
    /** `run`, counted as a message on `channel` each time it runs. The
     *  wrapper keeps `listener` as its `listener`, as EventEmitter's once
     *  wrappers do, so removeListener and off given `listener` remove it. */
    const counted = (channel: string, listener: Listener, run: Listener = listener) => Object.assign((event: IpcMainEvent, ...args: unknown[]) => {
      const start = now();
      try {
        run(event, ...args);
      } finally {
        noteMessage(channel, now() - start);
      }
    }, { listener });
    ipc.on = ((channel: string, listener: Listener) => on(channel, counted(channel, listener))) as IpcMain['on'];
    // Not EventEmitter's own once: it registers its wrapper through the on
    // above, so the emitter would hold this file's wrapper around that one,
    // and the once wrapper's removal of itself would find nothing.
    ipc.once = ((channel: string, listener: Listener) => {
      const wrapper = counted(channel, listener, (event, ...args) => {
        removeListener(channel, wrapper);
        listener(event, ...args);
      });
      return on(channel, wrapper);
    }) as IpcMain['once'];
  }

  /** Write a slow frame (or task) the window reported. */
  function logWindowFreeze(report: unknown): void {
    const r = sanitizeReport(report);
    if (!r) return;
    stats.slowFrames++;
    const parts = [`window took ${Math.round(r.durationMs)} ms over a ${r.kind}`];
    if (r.renderMs !== undefined) parts.push(`(style and layout ${Math.round(r.renderMs)} ms)`);
    let line = parts.join(' ');
    if (r.scripts && r.scripts.length > 0) line += `; longest scripts: ${r.scripts.join('; ')}`;
    emit(line);
  }

  return {
    tick,
    timeIpcHandlers,
    timeProcessLaunches,
    timeWork,
    timeAgentOutput,
    /** Count an event a session handed on (agent-session.ts). */
    noteAgentEvent(): void { agent.events++; },
    /** Count a change a turn's worktree watcher saw (turn-files.ts). */
    noteWorktreeChange(): void { worktreeChanges++; },
    watchGc,
    /** Write a stall still waiting for the next tick (at quit). */
    flush,
    logWindowFreeze,
    /** The totals since the last call, for the health line. */
    takeStats(): FreezeStats {
      const sorted = delays.sort((a, b) => a - b);
      const loopDelay = sorted.length > 0
        ? { p50: percentile(sorted, 0.5), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1] }
        : null;
      const agentOutput: AgentOutput = {
        events: agent.events - agentAtStats.events,
        chars: agent.chars - agentAtStats.chars,
        ms: agent.ms - agentAtStats.ms,
      };
      Object.assign(agentAtStats, agent);
      const taken = { ...stats, agentOutput, loopDelay };
      stats = emptyStats();
      delays = [];
      return taken;
    },
    /** Start (or restart) the clock the next tick is measured from. */
    start(): void { suspended = false; lastTick = now(); lastCpu = cpuMs?.() ?? 0; },
    /** The system is going to sleep: the timer stops, that's not a freeze. */
    suspend(): void { suspended = true; },
    resume(): void { suspended = false; lastTick = now(); lastCpu = cpuMs?.() ?? 0; },
  };
}

/** Hand every garbage collection Node reports to `onEntry`. */
function observeGcEntries(onEntry: (entry: GcEntry) => void): void {
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      // A gc entry's detail holds its kind (Node 16+); the types don't say so.
      const detail = (e as { detail?: { kind?: unknown } | null }).detail;
      onEntry({ startTime: e.startTime, duration: e.duration, kind: typeof detail?.kind === 'number' ? detail.kind : undefined });
    }
  });
  observer.observe({ entryTypes: ['gc'] });
}

/** A FreezeReport from the window, with every field checked, or null. */
export function sanitizeReport(value: unknown): FreezeReport | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 3_600_000) : undefined);
  const durationMs = ms(r.durationMs);
  if (durationMs === undefined || (r.kind !== 'frame' && r.kind !== 'task')) return null;
  const renderMs = ms(r.renderMs);
  const scripts = Array.isArray(r.scripts)
    ? r.scripts.filter((s): s is string => typeof s === 'string').slice(0, 5).map((s) => s.replace(/[\r\n]+/g, ' ').slice(0, 200))
    : undefined;
  return {
    kind: r.kind,
    durationMs,
    ...(renderMs !== undefined ? { renderMs } : {}),
    ...(scripts && scripts.length > 0 ? { scripts } : {}),
  };
}

export const freezeLog = createFreezeLog({ cpuMs: processCpuMs });

/** Start the main-process timer. Call once the app is ready (it listens to
 *  power events, which need that). */
export function startStallWatch(powerMonitor: Pick<PowerMonitor, 'on'>): void {
  // From now, not from when this file loaded: the wait for the app to be
  // ready isn't a freeze.
  freezeLog.start();
  freezeLog.watchGc();
  const timer = setInterval(freezeLog.tick, TICK_MS);
  timer.unref?.();
  powerMonitor.on('suspend', freezeLog.suspend);
  powerMonitor.on('resume', freezeLog.resume);
}
