/**
 * The memory of the processes Electron doesn't count, for the health line
 * (perf-health.ts): each thread's agent and everything it started (stdio MCP
 * servers, often node.exe under npx; language servers; background shells and
 * dev servers), and in dev mode the `npm start` and Vite processes above the
 * app. `app.getAppMetrics()` only covers Electron's own.
 *
 * Windows only. The process list comes from typeperf, which ships with
 * Windows and reads the process performance counters: each process's ID, its
 * parent's ID, its private bytes and its age, in one sample. It runs in the
 * agent host (runInAgentHost), so starting it never holds the main process,
 * and a typeperf that hangs is killed with its tree at TYPEPERF_TIMEOUT_MS
 * rather than get the git host restarted (it hung there once, on 21 Oct,
 * failing other threads' git commands). When the agent host isn't up the
 * field is left out rather than run here (`hostOnly`). Once the agent host
 * has given up for good (process-host.ts; the agents then run in the main
 * process), typeperf runs in the git host instead (runProcessInHost), still
 * never here: a hang there can get the git host restarted, but without it
 * the agents' memory would never be measured again. The other ways to list
 * processes with their parents don't fit: PowerShell (Get-CimInstance) must
 * never be started (process-tree.ts: AVG and Avast take a hidden PowerShell
 * started by electron.exe for malware), wmic is gone from recent Windows 11,
 * and tasklist has no parent IDs. typeperf has no command lines either, so
 * the largest processes are named by executable and the chain of executables
 * above them, which also keeps tokens in command-line arguments out of the
 * log.
 *
 * Two countersets list processes. The Process counterset names its
 * instances after the executable alone, numbering those that share it
 * (conhost#3), and those numbers aren't stable: when processes start or exit
 * around the sample, the values typeperf prints under conhost#3 can belong
 * to different processes, counter by counter. About half the busy health
 * lines of 23 Oct were garbage from it: thread agents listed as conhost.exe,
 * chrome.exe and svchost.exe put under agents, conhost.exe at 4.6 GB.
 * Windows 11 has the Process V2 counterset, whose instance names hold the
 * process ID, so each is one process. It is read when Windows has it; once
 * typeperf says there's no such counter (Windows 10), or fails to read them
 * a few times in a row (readV2()), the Process counterset is read from then
 * on. Either way a sample is checked before it is used (inconsistency()),
 * and one that doesn't hold together is skipped: the line says so rather
 * than show numbers. That check covers the processes the app knows (itself,
 * the agent host, the threads' agents), not the rest: on the Process
 * counterset the node#3 and conhost#3 under an agent can still hold other
 * node.exe and conhost.exe processes' numbers. So from it the line gives
 * only what the check vouches for, the threads' agents and their own
 * memory, and says it was read from the Process counters; what the agents
 * started, the largest processes and the dev server need Process V2.
 *
 * Private bytes (the Private Bytes counter) is the commit charge: what Task
 * Manager's Details tab shows as Commit size, and what Electron reports as
 * privateBytes for its own processes in the same line.
 */
import path from 'node:path';
import { logger } from './logger.js';
import { agentHostGaveUp, runProcessInHost } from './process-host.js';
import { recordCommandPids, runInAgentHost, type AgentHostRunOptions } from './process-host-run.js';
import { treeOf } from './process-tree-kill.js';

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
  /** Its executable, lowercase (claude.exe), when the adapter knows it. */
  exe?: string;
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
   *  agent and which aren't commands it ran for the app (gh, typeperf):
   *  one-off text generation, an agent just starting or stopping, or one
   *  the app lost track of. */
  untracked: number;
  /** Every process in their trees, agents included, by executable, largest first. */
  byExe: ExeTotal[];
  /** The largest processes in their trees, largest first. */
  largest: AgentTreeProcess[];
}

/** What a sample of the Process counterset vouches for (inconsistency()):
 *  the threads' agents themselves, not what they started. */
export interface AgentRootsMemory {
  /** Threads' agent processes found running. */
  agents: number;
  /** Their own private bytes, summed. */
  ownBytes: number;
}

/** The counterset typeperf read the processes from (Counterset). */
export type CountersetName = 'Process V2' | 'Process';

export type ProcessMemory = {
  counters: 'Process V2';
  agents: AgentMemory;
  /** The dev-mode processes above the app (npm, the dev script with Vite,
   *  and what they started), by executable; null when not in dev mode. */
  devServer: ExeTotal[] | null;
} | {
  /** The Process counterset, where same-named processes' numbers can mix
   *  up unseen: only the agents themselves, and no dev server. */
  counters: 'Process';
  agents: AgentRootsMemory;
  devServer: null;
};

/** typeperf's sample didn't hold together (inconsistency()), so it was
 *  skipped rather than shown. */
export interface SkippedSample {
  skipped: 'inconsistent';
}

export const SKIPPED: SkippedSample = Object.freeze({ skipped: 'inconsistent' });

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
const NO_PIDS: ReadonlySet<number> = new Set();

/** A path's folders: up to its last slash or backslash. */
const FOLDERS = /^.*[\\/]/;
const EXE_SUFFIX = /\.exe$/;

/**
 * An executable as the process list names it: lowercase, without its folder,
 * ending in .exe (C:\Apps\Grove Bench\Grove Bench.exe: grove bench.exe). The
 * one rule for the names the app expects (its own, index.ts; a thread's
 * agent's, claude-code.ts) and the names typeperf lists (exeOf()), so they
 * can't disagree. Takes a path, or an instance's name without its process
 * ID. .exe is added unless the name ends with it, whatever dots it has
 * (claude-2.1.0: claude-2.1.0.exe): Windows starts a program named without
 * .exe from name.exe, and the Process counterset names its instances
 * without .exe.
 */
export function windowsExeName(file: string): string {
  const name = file.replace(FOLDERS, '').toLowerCase();
  return EXE_SUFFIX.test(name) ? name : `${name}.exe`;
}

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

export interface AgentProcessesOptions {
  /** The agent host, whose other children count as agents no thread claims. */
  hostPid?: number;
  /** The commands the agent host ran for the app while the sample was taken
   *  (recordCommandPids(): gh and the git it starts, the claude CLI's calls,
   *  typeperf itself), which aren't agents: left out, with what they started. */
  commands?: ReadonlySet<number>;
  /** How many of the largest processes are listed. */
  top?: number;
}

/**
 * Sum the processes under each agent in `table`. `roots` are the threads'
 * agents; the agent host's other children count as agents no thread claims,
 * but for the commands it ran (`commands`). Agents that have exited (not in
 * the table) aren't counted, and each process is counted once, whatever the
 * PIDs say.
 */
export function agentProcesses(
  table: ProcessSample[],
  roots: AgentRoot[],
  { hostPid, commands = NO_PIDS, top = LARGEST }: AgentProcessesOptions = {},
): AgentMemory {
  const all: { root: number; thread: string | null }[] = roots.map((r) => ({ root: r.pid, thread: r.thread }));
  const known = new Set(roots.map((r) => r.pid));
  const host = hostPid === undefined ? undefined : table.find((p) => p.pid === hostPid);
  if (host) {
    for (const p of table) {
      if (p.ppid !== host.pid || p.pid === host.pid || known.has(p.pid) || !canBeParent(p, host)) continue;
      all.push({ root: p.pid, thread: null });
    }
  }

  // The commands' trees are never counted. A thread's agent that has a pid
  // one of them had during the sample is still the thread's agent.
  const counted = new Set<number>();
  for (const pid of commands) {
    if (known.has(pid)) continue;
    for (const p of treeOf(table, pid, canBeParent)) counted.add(p.pid);
  }
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
 * The threads' agents in `table`, each once, and their own memory: all a
 * sample of the Process counterset vouches for. inconsistency() checks each
 * agent's ID, name, parent and age, but nothing under it: its node#3 can
 * hold another node.exe's numbers.
 */
export function agentRoots(table: ProcessSample[], roots: AgentRoot[]): AgentRootsMemory {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const found = new Set<number>();
  let ownBytes = 0;
  for (const { pid } of roots) {
    const agent = byPid.get(pid);
    if (!agent || found.has(pid)) continue;
    found.add(pid);
    ownBytes += agent.bytes;
  }
  return { agents: found.size, ownBytes };
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

/** The app's main process and its executable, lowercase (grove bench.exe,
 *  or electron.exe in dev mode), which the agent host runs too. */
export interface MainProcess {
  pid: number;
  exe: string;
}

/** What a sample is checked against: processes the app knows. */
export interface SampleAnchors {
  /** The threads' agents. */
  roots: AgentRoot[];
  /** The agent host, while it is up. */
  hostPid?: number;
  main?: MainProcess;
}

/**
 * Why a process table doesn't hold together, if it doesn't. Each check is
 * on processes the app knows, which a good sample always gets right, while
 * a sample whose counters belong to different processes (the Process
 * counterset's conhost#3) gets them wrong:
 *
 * - No PID is listed twice.
 * - The main process is in it, named as its executable; so is the agent
 *   host, if in it (it may have restarted since), and its parent is the
 *   main process.
 * - Each thread's agent that is in it (one started after the sample isn't)
 *   is named as its executable, when the adapter knows it (claude.exe), and,
 *   while the agent host is up, is a child of it, or of the main process
 *   (where agents start while the agent host is down), started after it.
 *
 * Totals aren't compared with the last sample's: agents' memory can grow by
 * gigabytes in a period (a build, a dev server), and a sample that mixes up
 * processes moves memory between executables more than it changes the sum.
 */
export function inconsistency(table: ProcessSample[], { roots, hostPid, main }: SampleAnchors): string | undefined {
  const byPid = new Map<number, ProcessSample>();
  for (const p of table) {
    const twin = byPid.get(p.pid);
    if (twin) return `pid ${p.pid} is listed twice, as ${twin.name} and ${p.name}`;
    byPid.set(p.pid, p);
  }
  if (main) {
    const app = byPid.get(main.pid);
    if (!app) return `the app's own process (pid ${main.pid}) isn't in it`;
    if (app.name !== main.exe) return `the app's own process (pid ${main.pid}) is listed as ${app.name}, not ${main.exe}`;
    const host = hostPid === undefined ? undefined : byPid.get(hostPid);
    if (host && host.name !== main.exe) return `the agent host (pid ${host.pid}) is listed as ${host.name}, not ${main.exe}`;
    if (host && (host.ppid !== main.pid || !canBeParent(host, app))) return `the agent host (pid ${host.pid}) is listed under pid ${host.ppid}, not the app's own process`;
  }
  // Unknown while the agent host restarts, when its agents may still be
  // running under the one before.
  const parents = hostPid === undefined ? undefined : new Set([hostPid, main?.pid]);
  for (const root of roots) {
    const agent = byPid.get(root.pid);
    if (!agent) continue;
    const what = `thread ${root.thread}'s agent (pid ${root.pid})`;
    if (root.exe && agent.name !== root.exe) return `${what} is listed as ${agent.name}, not ${root.exe}`;
    if (!parents) continue;
    const parent = byPid.get(agent.ppid);
    if (!parents.has(agent.ppid) || !parent || !canBeParent(agent, parent)) {
      return `${what} is listed under pid ${agent.ppid}${parent ? ` (${parent.name})` : ''}, not the agent host or the app`;
    }
  }
  return undefined;
}

type Field = 'pid' | 'ppid' | 'bytes' | 'ageSec';

/** A counterset typeperf reads processes from, and the counters it reads,
 *  in English: on a Windows in another language typeperf turns them down,
 *  and the field is left out. */
export interface Counterset {
  object: CountersetName;
  counters: Record<Field, string>;
}

/**
 * Windows 11's Process V2 counterset: an instance per process, its name
 * holding the process ID. Its counters are named as Prometheus's
 * windows_exporter reads them (perfDataCounterValuesV2): the Process
 * counterset's, but for "Process ID". Its instance names are only keys
 * here, whatever their format: exeOf() takes the executable from one
 * without its process ID (windows_exporter reads them as name:pid), and a
 * name:pid whose pid isn't the Process ID counter's fails the sample.
 */
export const PROCESS_V2: Counterset = {
  object: 'Process V2',
  counters: { pid: 'Process ID', ppid: 'Creating Process ID', bytes: 'Private Bytes', ageSec: 'Elapsed Time' },
};

/** The Process counterset, on every Windows: instances named after the
 *  executable, numbered when several run (node#3). */
export const PROCESS_LEGACY: Counterset = {
  object: 'Process',
  counters: { pid: 'ID Process', ppid: 'Creating Process ID', bytes: 'Private Bytes', ageSec: 'Elapsed Time' },
};

/** typeperf's arguments: one sample of each counter for every process. */
export function typeperfArgs(set: Counterset): string[] {
  return [...Object.values(set.counters).map((c) => `\\${set.object}(*)\\${c}`), '-sc', '1'];
}

/** A counter's path in typeperf's header: \\HOST\Process(node#2)\ID Process. */
const COUNTER_PATH = /^\\\\[^\\]*\\([^\\(]+)\((.*)\)\\([^\\]+)$/;
const LINE_BREAK = /\r?\n/;
/** A quoted CSV field, and a quote in one. */
const QUOTED_FIELD = /"((?:[^"]|"")*)"/g;
const DOUBLED_QUOTE = /""/g;
/** An instance named name:pid, as Process V2 names them. */
const NAME_COLON_PID = /:(\d+)$/;
/** An instance's name ending with a number beside a separator (Process V2's
 *  name:pid, the Process counterset's name_pid where ProcessNameFormat says
 *  so), or starting with one (pid:name). */
const TRAILING_ID = /^(.+?)[\s:_#([-]+(\d+)[)\]]?$/;
const LEADING_ID = /^[([]?(\d+)[)\]\s:_#-]+(.+)$/;
/** The number the Process counterset tells same-named processes apart by (node#3). */
const INSTANCE_INDEX = /#\d+$/;

/** The fields of a CSV line whose fields are all quoted, as typeperf's are. */
function quotedFields(line: string): string[] {
  return [...line.matchAll(QUOTED_FIELD)].map((m) => m[1].replace(DOUBLED_QUOTE, '"'));
}

/** A counter value; NaN for a blank one (the process exited before the
 *  sample was taken). */
function counterValue(text: string): number {
  const t = text.trim();
  return t === '' ? NaN : Number(t.replace(',', '.'));
}

/** The executable an instance names (windowsExeName()): without its process
 *  ID, where it ends (or starts) with it beside a separator (TRAILING_ID),
 *  or the number that tells same-named processes apart (node#3). */
function exeOf(instance: string, pid: number): string {
  const id = String(pid);
  const trailing = TRAILING_ID.exec(instance);
  const leading = LEADING_ID.exec(instance);
  const withoutId = trailing?.[2] === id ? trailing[1] : leading?.[1] === id ? leading[2] : instance;
  return windowsExeName(withoutId.replace(INSTANCE_INDEX, ''));
}

export interface TypeperfSample {
  processes: ProcessSample[];
  /** Why the sample doesn't hold together as printed, if it doesn't: a
   *  value for every counter, and an instance whose name ends with a
   *  process ID (name:pid) is that process. */
  problem?: string;
}

/**
 * The process table from typeperf's CSV output (typeperfArgs(set)): a header
 * of counter paths, then one line of values. Idle and _Total (PID 0) and
 * processes that had exited are left out. Null when the output has no sample
 * of `set`'s counters, as when typeperf turned them down.
 */
export function parseTypeperf(stdout: string, set: Counterset = PROCESS_LEGACY): TypeperfSample | null {
  const lines = stdout.split(LINE_BREAK);
  const headerAt = lines.findIndex((l) => l.startsWith('"(PDH-CSV'));
  if (headerAt < 0) return null;
  const data = lines.slice(headerAt + 1).find((l) => l.startsWith('"'));
  if (!data) return null;
  const header = quotedFields(lines[headerAt]);
  const values = quotedFields(data);
  const fieldOf = new Map<string, Field>(Object.entries(set.counters).map(([field, counter]) => [counter.toLowerCase(), field as Field]));

  const instances = new Map<string, Partial<Record<Field, number>>>();
  for (let i = 1; i < header.length && i < values.length; i++) {
    const match = COUNTER_PATH.exec(header[i]);
    const field = match && match[1].toLowerCase() === set.object.toLowerCase() ? fieldOf.get(match[3].toLowerCase()) : undefined;
    if (!match || !field) continue;
    const fields = instances.get(match[2]) ?? {};
    fields[field] = counterValue(values[i]);
    instances.set(match[2], fields);
  }
  if (instances.size === 0) return null;

  let problem = values.length === header.length ? undefined : `${values.length - 1} values for ${header.length - 1} counters`;
  const processes: ProcessSample[] = [];
  for (const [instance, f] of instances) {
    const { pid, ppid, bytes, ageSec } = f;
    if (pid === undefined || ppid === undefined || !Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue;
    const named = NAME_COLON_PID.exec(instance);
    if (named && Number(named[1]) !== pid) problem ??= `instance ${instance} has process ID ${pid}`;
    processes.push({
      pid,
      ppid,
      name: exeOf(instance, pid),
      bytes: Number.isFinite(bytes) ? bytes! : 0,
      ...(Number.isFinite(ageSec) && ageSec! >= 0 ? { ageSec } : {}),
    });
  }
  return { processes, ...(problem ? { problem } : {}) };
}

/** Longest typeperf may take. It usually takes a second or two. */
export const TYPEPERF_TIMEOUT_MS = 30_000;

/** Process V2 reads in a row, without a good sample since, that printed
 *  none (and didn't say there's no such counter), before the Process
 *  counterset is read instead from then on. Until then each such read only
 *  skips its period: a PDH "data is not valid", or no data line. */
export const V2_UNREADABLE_LIMIT = 3;
/** Process V2 reads in a row, without a good sample since, that timed out
 *  (TYPEPERF_TIMEOUT_MS each, every period) before the Process counterset is
 *  read instead from then on. */
export const V2_TIMEOUT_LIMIT = 2;

export type RunTypeperf = (file: string, args: string[], options: AgentHostRunOptions) => Promise<{ stdout: string }>;

export interface MeasureOptions {
  /** The threads' running agents, read once the process list is in, so they
   *  match it as closely as they can. */
  agents: () => AgentRoot[];
  /** The agent host's process id, while it is up. */
  agentHostPid?: () => number | undefined;
  /** The app's main process, which every sample is checked for. */
  main?: MainProcess;
  /** Also list the dev server above the main process (dev mode). */
  devServer?: boolean;
  /** Runs typeperf; by default in the agent host, or in the git host once
   *  the agent host has given up (runTypeperf). */
  run?: RunTypeperf;
  /** Starts recording the commands the agent host runs for the app, whose
   *  processes aren't agents; the function it returns stops and returns
   *  their pids. By default recordCommandPids (process-host-run.ts). */
  recordCommandPids?: () => () => ReadonlySet<number>;
  platform?: NodeJS.Platform;
  /** Where the first failure, the first sample skipped and the switch to
   *  the Process counterset are noted; later ones aren't. */
  note?: (line: string) => void;
}

/** Whether Windows has the Process V2 counterset: unknown until typeperf has
 *  read it, and rejected once it is given up on for the run (readV2()). */
let processV2: 'unknown' | 'works' | 'rejected' = 'unknown';
/** Process V2 reads in a row, since its last good sample, that printed no
 *  sample of it, and that timed out. */
let v2Unreadable = 0;
let v2TimedOut = 0;
let notedFailure = false;
let notedSkip = false;

/**
 * typeperf in the agent host, never in the main process (`hostOnly`): when
 * the agent host isn't up, it fails and the period goes without. Once the
 * agent host has given up for good, in the git host instead, still never
 * here. Its timeout there kills typeperf alone, not its tree, and a hang
 * past it gets the git host restarted, as on 21 Oct; but the agent host
 * won't be back, and the agents (in the main process then) would never be
 * measured again.
 */
const runTypeperf: RunTypeperf = (file, args, options) =>
  agentHostGaveUp() ? runProcessInHost(file, args, { timeout: options.timeout }) : runInAgentHost(file, args, options);

interface TypeperfRun {
  /** What it printed, stdout then stderr. */
  output: string;
  exitCode: number;
}

/**
 * What typeperf printed reading `set`, once it has run to the end, whatever
 * its exit code: it may exit with an error when it turns the counters down.
 * Throws when it didn't run to the end (it timed out, or couldn't start, as
 * when the agent host is down).
 */
async function typeperf(run: RunTypeperf, set: Counterset): Promise<TypeperfRun> {
  // Full path, so a typeperf.exe in the working folder or on PATH can't stand in.
  const exe = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'typeperf.exe');
  try {
    return { output: (await run(exe, typeperfArgs(set), { timeout: TYPEPERF_TIMEOUT_MS, hostOnly: true })).stdout, exitCode: 0 };
  } catch (e) {
    const { exitCode, timedOut, stdout, stderr } = (e ?? {}) as { exitCode?: unknown; timedOut?: unknown; stdout?: unknown; stderr?: unknown };
    if (typeof exitCode !== 'number' || timedOut) throw e;
    return { output: [stdout, stderr].filter((t) => typeof t === 'string' && t !== '').join('\n'), exitCode };
  }
}

const excerpt = (output: string) => output.trim().slice(0, 200);

/** typeperf's answer when none of the counter paths it was given exists, as
 *  for Process V2 on Windows 10 (PdhAddCounter fails for each). */
const NO_VALID_COUNTERS = /^\s*Error: No valid counters\b/m;
/** PDH's own statuses for that, PDH_CSTATUS_NO_OBJECT (0xC0000BB8) and
 *  PDH_CSTATUS_NO_COUNTER (0xC0000BB9), as Node reports an exit code with
 *  them (unsigned) and as a signed int, in case typeperf exits with them. */
const NO_SUCH_COUNTER_EXIT_CODES = new Set([0xC0000BB8, 0xC0000BB9, 0xC0000BB8 - 2 ** 32, 0xC0000BB9 - 2 ** 32]);

/**
 * Whether typeperf said the counters don't exist, rather than failed to read
 * them this time. Only these, matched conservatively: the line typeperf
 * prints when no counter path it was given is valid ("Error: No valid
 * counters."), in English (on a Windows in another language it is
 * translated, but there the English counter names fail too, Process V2's
 * and the Process counterset's alike), or PDH's "no such object" or "no
 * such counter" status as its exit code. Not a PDH "data is not valid", a
 * timeout or output with no sample in it: those may pass.
 */
function saysNoSuchCounters({ output, exitCode }: TypeperfRun): boolean {
  return NO_VALID_COUNTERS.test(output) || NO_SUCH_COUNTER_EXIT_CODES.has(exitCode);
}

/** From now on, processes are listed from the Process counterset. */
function giveUpV2(note: (line: string) => void, why: string): void {
  processV2 = 'rejected';
  note(`[process-memory] Processes are listed from the Process counters from now on, not Process V2 (${why}); from those the health line gives only the threads' agents and their own memory, since numbers mixed up among same-named processes can't all be caught`);
}

/**
 * A sample of Process V2. Null when it has just been given up on, for the
 * Process counterset to be read this period: typeperf said there's no such
 * counter (before it has ever read them), or this is the
 * V2_UNREADABLE_LIMITth read in a row that printed no sample of them.
 * Throws, for this period to go without, when this read failed but the next
 * may not: it timed out (the V2_TIMEOUT_LIMITth in a row gives Process V2
 * up for the next period, this one having waited long enough), printed no
 * sample, or couldn't start (which says nothing about Process V2).
 */
async function readV2(run: RunTypeperf, note: (line: string) => void): Promise<TypeperfSample | null> {
  let read: TypeperfRun;
  try {
    read = await typeperf(run, PROCESS_V2);
  } catch (e) {
    if ((e as { timedOut?: unknown } | null)?.timedOut === true && ++v2TimedOut >= V2_TIMEOUT_LIMIT) {
      giveUpV2(note, `typeperf timed out reading them ${v2TimedOut} times in a row`);
    }
    throw e;
  }
  const v2 = parseTypeperf(read.output, PROCESS_V2);
  if (v2 && v2.processes.length > 0) {
    processV2 = 'works';
    v2Unreadable = 0;
    v2TimedOut = 0;
    return v2;
  }
  const printed = excerpt(read.output) || `no output, exit code ${read.exitCode}`;
  // Once it has read them, Windows has them: this read failed, not the counterset.
  if (processV2 === 'unknown' && saysNoSuchCounters(read)) {
    giveUpV2(note, `typeperf says there are no such counters, as on Windows 10: ${printed}`);
    return null;
  }
  if (++v2Unreadable >= V2_UNREADABLE_LIMIT) {
    giveUpV2(note, `typeperf printed no sample of them ${v2Unreadable} times in a row: ${printed}`);
    return null;
  }
  throw new Error(`no Process V2 sample in its output, tried again next time: ${printed}`);
}

/** One sample: of Process V2 while Windows may have it, otherwise of the
 *  Process counterset. */
async function sample(run: RunTypeperf, note: (line: string) => void): Promise<TypeperfSample & { counters: CountersetName }> {
  if (processV2 !== 'rejected') {
    const v2 = await readV2(run, note);
    if (v2) return { ...v2, counters: PROCESS_V2.object };
  }
  const { output } = await typeperf(run, PROCESS_LEGACY);
  const legacy = parseTypeperf(output, PROCESS_LEGACY);
  if (!legacy || legacy.processes.length === 0) throw new Error(`no process counters in its output: ${excerpt(output)}`);
  return { ...legacy, counters: PROCESS_LEGACY.object };
}

/**
 * Measure the agents' processes (and the dev server's), for the health line.
 * Null on any platform but Windows, and when the process list can't be had:
 * the agent host isn't up, typeperf failed or timed out, or printed no
 * sample. SKIPPED when the sample didn't hold together (inconsistency()).
 * From the Process counterset, only the agents themselves (agentRoots()).
 * Never throws.
 */
export async function measureProcesses(opts: MeasureOptions): Promise<ProcessMemory | SkippedSample | null> {
  if ((opts.platform ?? process.platform) !== 'win32') return null;
  const run = opts.run ?? runTypeperf;
  const note = opts.note ?? ((line: string) => logger.info(line));
  // From before typeperf starts, so it is among them.
  const commandsSince = (opts.recordCommandPids ?? recordCommandPids)();
  try {
    const { processes, problem: printed, counters } = await sample(run, note);
    const commands = commandsSince();
    const roots = opts.agents();
    const hostPid = opts.agentHostPid?.();
    const problem = printed ?? inconsistency(processes, { roots, hostPid, main: opts.main });
    if (problem) {
      if (!notedSkip) {
        notedSkip = true;
        note(`[process-memory] typeperf's process list didn't hold together (${problem}), so the health line skipped the agents' memory; it does each time, noted only here`);
      }
      return SKIPPED;
    }
    if (counters === 'Process') return { counters, agents: agentRoots(processes, roots), devServer: null };
    return {
      counters,
      agents: agentProcesses(processes, roots, { hostPid, commands }),
      devServer: opts.devServer && opts.main ? devServerProcesses(processes, opts.main.pid) : null,
    };
  } catch (e) {
    if (!notedFailure) {
      notedFailure = true;
      note(`[process-memory] Couldn't list processes with typeperf, so the health line leaves out the agents' memory: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  } finally {
    commandsSince();
  }
}

/** Forget what was noted, and whether Windows has Process V2. */
export function resetForTests(): void {
  processV2 = 'unknown';
  v2Unreadable = 0;
  v2TimedOut = 0;
  notedFailure = false;
  notedSkip = false;
}
