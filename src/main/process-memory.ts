/**
 * The memory of the processes Electron doesn't count, for the health line
 * (perf-health.ts): each thread's agent and everything it started (stdio MCP
 * servers, often node.exe under npx; language servers; background shells and
 * dev servers), and in dev mode the `npm start` and Vite processes above the
 * app. `app.getAppMetrics()` only covers Electron's own.
 *
 * Windows only. The process list comes from typeperf, which ships with
 * Windows and reads the Process performance counters: each process's ID, its
 * parent's ID, its private bytes and its age, in one sample. It runs in the
 * process host (runProcessInHost), so starting it never holds the main
 * process, and when the host isn't up the field is left out rather than run
 * here. The other ways to list processes with their parents don't fit:
 * PowerShell (Get-CimInstance) must never be started (process-tree.ts: AVG
 * and Avast take a hidden PowerShell started by electron.exe for malware),
 * wmic is gone from recent Windows 11, and tasklist has no parent IDs.
 * typeperf has no command lines either, so the largest processes are named by
 * executable and the chain of executables above them, which also keeps
 * tokens in command-line arguments out of the log.
 *
 * Private bytes (the Process object's Private Bytes counter) is the commit
 * charge: what Task Manager's Details tab shows as Commit size, and what
 * Electron reports as privateBytes for its own processes in the same line.
 */
import path from 'node:path';
import { logger } from './logger.js';
import { runProcessInHost } from './process-host.js';
import type { HostedOptions } from './process-host-protocol.js';
import { treeOf } from './process-tree.js';

/** One process, from a snapshot of the process table. */
export interface ProcessSample {
  pid: number;
  ppid: number;
  /** Its executable, lowercase, such as node.exe. */
  name: string;
  /** Private bytes. */
  bytes: number;
  /** Seconds since it started, when known. */
  ageSec?: number;
}

/** A thread's running agent process. */
export interface AgentRoot {
  thread: string;
  pid: number;
}

/** The processes of one executable, summed. */
export interface ExeTotal {
  name: string;
  count: number;
  bytes: number;
}

/** A large process in an agent's tree. */
export interface AgentTreeProcess {
  name: string;
  pid: number;
  bytes: number;
  /** The thread whose agent it is under; null for one no thread claims. */
  thread: string | null;
  /** The executables from the agent down to its parent; empty for the agent
   *  itself. Long chains keep their two ends (CHAIN_ENDS). */
  under: string[];
}

export interface AgentMemory {
  /** Threads' agent processes found running. */
  agents: number;
  /** Other processes the agent host started, which no thread says is its
   *  agent: one-off text generation, an agent just starting or stopping, or
   *  one the app lost track of. */
  untracked: number;
  /** Every process in their trees, agents included, by executable, largest first. */
  byExe: ExeTotal[];
  /** The largest processes in their trees, largest first. */
  largest: AgentTreeProcess[];
}

export interface ProcessMemory {
  agents: AgentMemory;
  /** The dev-mode processes above the app (npm, the dev script with Vite,
   *  and what they started), by executable; null when not in dev mode. */
  devServer: ExeTotal[] | null;
}

/** How many of the largest processes are listed. */
export const LARGEST = 5;
/** A chain longer than this keeps its first executable and its last ones. */
const CHAIN_ENDS = { first: 1, last: 3 };
/** How far above the app the dev server can be: the dev script's node.exe,
 *  npm's cmd.exe and node.exe, and npm.cmd's cmd.exe. */
const DEV_ANCESTORS = 4;
/** A child is younger than its parent. Ages are read in one sample, but
 *  allow for rounding. */
const AGE_SLACK_SEC = 1;

/** Whether `parent` can be `child`'s parent: not started after it. A parent
 *  that exited leaves its PID to be reused, and a process started later with
 *  that PID isn't the parent. */
function canBeParent(child: ProcessSample, parent: ProcessSample): boolean {
  if (child.ageSec === undefined || parent.ageSec === undefined) return true;
  return child.ageSec <= parent.ageSec + AGE_SLACK_SEC;
}

function byExe(processes: ProcessSample[]): ExeTotal[] {
  const totals = new Map<string, ExeTotal>();
  for (const p of processes) {
    const total = totals.get(p.name);
    if (total) {
      total.count++;
      total.bytes += p.bytes;
    } else {
      totals.set(p.name, { name: p.name, count: 1, bytes: p.bytes });
    }
  }
  return [...totals.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

/** The executables from the tree's root down to `p`'s parent. */
function chainAbove(p: ProcessSample, tree: Map<number, ProcessSample>, rootPid: number): string[] {
  const chain: string[] = [];
  let at = p;
  // Each process in a tree came after its parent, so this ends at the root;
  // the bound is for safety.
  for (let i = 0; at.pid !== rootPid && i < tree.size; i++) {
    const parent = tree.get(at.ppid);
    if (!parent) break;
    chain.unshift(parent.name);
    at = parent;
  }
  return chain.length > CHAIN_ENDS.first + CHAIN_ENDS.last
    ? [...chain.slice(0, CHAIN_ENDS.first), '…', ...chain.slice(-CHAIN_ENDS.last)]
    : chain;
}

/**
 * Sum the processes under each agent in `table`. `roots` are the threads'
 * agents; `hostPid` is the agent host, whose other children count as agents
 * no thread claims. Agents that have exited (not in the table) aren't
 * counted, and each process is counted once, whatever the PIDs say.
 */
export function agentProcesses(table: ProcessSample[], roots: AgentRoot[], hostPid?: number, top = LARGEST): AgentMemory {
  const all: { root: number; thread: string | null }[] = roots.map((r) => ({ root: r.pid, thread: r.thread }));
  const host = hostPid === undefined ? undefined : table.find((p) => p.pid === hostPid);
  if (host) {
    const known = new Set(roots.map((r) => r.pid));
    for (const p of table) {
      if (p.ppid === host.pid && p.pid !== host.pid && !known.has(p.pid) && canBeParent(p, host)) all.push({ root: p.pid, thread: null });
    }
  }

  const counted = new Set<number>();
  const found: (ProcessSample & { thread: string | null; tree: Map<number, ProcessSample>; root: number })[] = [];
  let agents = 0;
  let untracked = 0;
  for (const { root, thread } of all) {
    if (counted.has(root)) continue;
    const tree = treeOf(table, root, canBeParent).filter((p) => !counted.has(p.pid));
    if (tree.length === 0) continue;
    if (thread === null) untracked++;
    else agents++;
    const members = new Map(tree.map((p) => [p.pid, p]));
    for (const p of tree) {
      counted.add(p.pid);
      found.push({ ...p, thread, tree: members, root });
    }
  }

  const largest = [...found].sort((a, b) => b.bytes - a.bytes).slice(0, top).map((p) => ({
    name: p.name, pid: p.pid, bytes: p.bytes, thread: p.thread, under: chainAbove(p, p.tree, p.root),
  }));
  return { agents, untracked, byExe: byExe(found), largest };
}

/**
 * In dev mode, the processes above the app that `npm start` runs: from the
 * topmost node.exe within a few steps above `appPid` (cmd.exe between them),
 * everything under it except the app's own tree, which Electron's metrics and
 * the agents' line already count. Null when the app wasn't started by node
 * (a packaged app's parent is explorer.exe).
 */
export function devServerProcesses(table: ProcessSample[], appPid: number): ExeTotal[] | null {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  let at = byPid.get(appPid);
  let top: ProcessSample | undefined;
  const seen = new Set<number>();
  for (let i = 0; at && i < DEV_ANCESTORS; i++) {
    seen.add(at.pid);
    const parent = byPid.get(at.ppid);
    if (!parent || seen.has(parent.pid) || !canBeParent(at, parent)) break;
    if (parent.name === 'node.exe') top = parent;
    else if (parent.name !== 'cmd.exe') break;
    at = parent;
  }
  if (!top) return null;

  const app = new Set(treeOf(table, appPid, canBeParent).map((p) => p.pid));
  return byExe(treeOf(table, top.pid, canBeParent).filter((p) => !app.has(p.pid)));
}

/** The counters typeperf reads, in English: on a Windows in another
 *  language typeperf turns them down, and the field is left out. */
const COUNTERS = {
  pid: 'ID Process',
  ppid: 'Creating Process ID',
  bytes: 'Private Bytes',
  ageSec: 'Elapsed Time',
} as const;
type Field = keyof typeof COUNTERS;
const FIELD_OF = new Map<string, Field>(Object.entries(COUNTERS).map(([field, counter]) => [counter, field as Field]));

/** typeperf's arguments: one sample of each counter for every process. */
export const TYPEPERF_ARGS = [...Object.values(COUNTERS).map((c) => `\\Process(*)\\${c}`), '-sc', '1'];

/** A counter's path in typeperf's header: \\HOST\Process(node#2)\ID Process. */
const COUNTER_PATH = /^\\\\[^\\]*\\[^\\(]+\((.*)\)\\([^\\]+)$/;

/** The fields of a CSV line whose fields are all quoted, as typeperf's are. */
function quotedFields(line: string): string[] {
  return [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
}

/** A counter value; NaN for a blank one (the process exited before the
 *  sample was taken). */
function counterValue(text: string): number {
  const t = text.trim();
  return t === '' ? NaN : Number(t.replace(',', '.'));
}

/**
 * The process table from typeperf's CSV output (TYPEPERF_ARGS): a header of
 * counter paths, then one line of values. Instances are named after the
 * executable without its extension, numbered when several run (node#3).
 * Idle and _Total (PID 0) and processes that had exited are left out. Null
 * when the output has no sample.
 */
export function parseTypeperf(stdout: string): ProcessSample[] | null {
  const lines = stdout.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.startsWith('"(PDH-CSV'));
  if (headerAt < 0) return null;
  const data = lines.slice(headerAt + 1).find((l) => l.startsWith('"'));
  if (!data) return null;
  const header = quotedFields(lines[headerAt]);
  const values = quotedFields(data);

  const instances = new Map<string, Partial<Record<Field, number>>>();
  for (let i = 1; i < header.length && i < values.length; i++) {
    const match = COUNTER_PATH.exec(header[i]);
    const field = match && FIELD_OF.get(match[2]);
    if (!match || !field) continue;
    const fields = instances.get(match[1]) ?? {};
    fields[field] = counterValue(values[i]);
    instances.set(match[1], fields);
  }

  const table: ProcessSample[] = [];
  for (const [instance, f] of instances) {
    const { pid, ppid, bytes, ageSec } = f;
    if (pid === undefined || ppid === undefined || !Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue;
    table.push({
      pid,
      ppid,
      name: `${instance.replace(/#\d+$/, '').toLowerCase()}.exe`,
      bytes: Number.isFinite(bytes) ? bytes! : 0,
      ...(Number.isFinite(ageSec) && ageSec! >= 0 ? { ageSec } : {}),
    });
  }
  return table;
}

/** Longest typeperf may take. It usually takes a second or two. */
export const TYPEPERF_TIMEOUT_MS = 30_000;

export interface MeasureOptions {
  /** The threads' running agents, read once the process list is in, so they
   *  match it as closely as they can. */
  agents: () => AgentRoot[];
  /** The agent host's process id, while it is up. */
  agentHostPid?: () => number | undefined;
  /** The app's main process, in dev mode only. */
  appPid?: number;
  run?: (file: string, args: string[], options: HostedOptions) => Promise<{ stdout: string }>;
  platform?: NodeJS.Platform;
  /** Where the first failure is noted; later ones aren't. */
  note?: (line: string) => void;
}

let noted = false;

/**
 * Measure the agents' processes (and the dev server's), for the health line.
 * Null on any platform but Windows, and when the process list can't be had:
 * the process host isn't up, typeperf failed or timed out, or printed no
 * sample. Never throws.
 */
export async function measureProcesses(opts: MeasureOptions): Promise<ProcessMemory | null> {
  if ((opts.platform ?? process.platform) !== 'win32') return null;
  const run = opts.run ?? runProcessInHost;
  try {
    // Full path, so a typeperf.exe in the working folder or on PATH can't stand in.
    const exe = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'typeperf.exe');
    const { stdout } = await run(exe, TYPEPERF_ARGS, { timeout: TYPEPERF_TIMEOUT_MS });
    const table = parseTypeperf(stdout);
    if (!table || table.length === 0) throw new Error(`no process counters in its output: ${stdout.trim().slice(0, 200)}`);
    return {
      agents: agentProcesses(table, opts.agents(), opts.agentHostPid?.()),
      devServer: opts.appPid !== undefined ? devServerProcesses(table, opts.appPid) : null,
    };
  } catch (e) {
    if (!noted) {
      noted = true;
      (opts.note ?? ((line) => logger.info(line)))(
        `[process-memory] Couldn't list processes with typeperf, so the health line leaves out the agents' memory: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return null;
  }
}

/** Note the next failure again. */
export function resetNotedForTests(): void {
  noted = false;
}
