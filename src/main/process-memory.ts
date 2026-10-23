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
 * field is left out rather than run here (`hostOnly`). The other ways to list
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
 * typeperf turns it down (Windows 10), the Process counterset is read from
 * then on. Either way a sample is checked before it is used
 * (inconsistency()), and one that doesn't hold together is skipped: the line
 * says so rather than show numbers.
 *
 * Private bytes (the Private Bytes counter) is the commit charge: what Task
 * Manager's Details tab shows as Commit size, and what Electron reports as
 * privateBytes for its own processes in the same line.
 */
import path from 'node:path';
import { logger } from './logger.js';
import { runInAgentHost, type AgentHostRunOptions } from './process-host-run.js';
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
/** The process list's own process: typeperf, which the agent host starts
 *  for it, and which isn't an agent. */
const SAMPLER = 'typeperf.exe';

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
 * no thread claims (but not typeperf, which lists them). Agents that have
 * exited (not in the table) aren't counted, and each process is counted
 * once, whatever the PIDs say.
 */
export function agentProcesses(table: ProcessSample[], roots: AgentRoot[], hostPid?: number, top = LARGEST): AgentMemory {
  const all: { root: number; thread: string | null }[] = roots.map((r) => ({ root: r.pid, thread: r.thread }));
  const host = hostPid === undefined ? undefined : table.find((p) => p.pid === hostPid);
  if (host) {
    const known = new Set(roots.map((r) => r.pid));
    for (const p of table) {
      if (p.ppid !== host.pid || p.pid === host.pid || known.has(p.pid) || !canBeParent(p, host) || p.name === SAMPLER) continue;
      all.push({ root: p.pid, thread: null });
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
  object: string;
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

/** The executable an instance names, as name.exe: without its process ID,
 *  where it ends (or starts) with it beside a separator (Process V2's
 *  name:pid, or the Process counterset's name_pid where ProcessNameFormat
 *  says so), or the number that tells same-named processes apart (node#3). */
function exeOf(instance: string, pid: number): string {
  const withoutId = new RegExp(`^(.+?)[\\s:_#(\\[-]+${pid}[)\\]]?$`).exec(instance)?.[1]
    ?? new RegExp(`^[(\\[]?${pid}[)\\]\\s:_#-]+(.+)$`).exec(instance)?.[1];
  const name = (withoutId ?? instance).replace(/#\d+$/, '').toLowerCase();
  return name.endsWith('.exe') ? name : `${name}.exe`;
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
  const lines = stdout.split(/\r?\n/);
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
    const named = /:(\d+)$/.exec(instance);
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
  run?: RunTypeperf;
  platform?: NodeJS.Platform;
  /** Where the first failure, the first sample skipped and the switch to
   *  the Process counterset are noted; later ones aren't. */
  note?: (line: string) => void;
}

/** Whether Windows has the Process V2 counterset: unknown until typeperf has
 *  read it or turned it down. Not asked again once it has answered. */
let processV2: 'unknown' | 'works' | 'rejected' = 'unknown';
let notedFailure = false;
let notedSkip = false;

/**
 * What typeperf printed reading `set`, once it has run to the end, whatever
 * its exit code: it may exit with an error when it turns the counters down.
 * Throws when it didn't run to the end (it timed out, or couldn't start, as
 * when the agent host is down).
 */
async function typeperf(run: RunTypeperf, set: Counterset): Promise<string> {
  // Full path, so a typeperf.exe in the working folder or on PATH can't stand in.
  const exe = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'typeperf.exe');
  try {
    return (await run(exe, typeperfArgs(set), { timeout: TYPEPERF_TIMEOUT_MS, hostOnly: true })).stdout;
  } catch (e) {
    const { exitCode, timedOut, stdout, stderr } = (e ?? {}) as { exitCode?: unknown; timedOut?: unknown; stdout?: unknown; stderr?: unknown };
    if (typeof exitCode !== 'number' || timedOut) throw e;
    return [stdout, stderr].filter((t) => typeof t === 'string' && t !== '').join('\n');
  }
}

const excerpt = (output: string) => output.trim().slice(0, 200);

/** One sample: of Process V2 while Windows may have it, otherwise of the
 *  Process counterset. */
async function sample(run: RunTypeperf, note: (line: string) => void): Promise<TypeperfSample> {
  if (processV2 !== 'rejected') {
    const output = await typeperf(run, PROCESS_V2);
    const v2 = parseTypeperf(output, PROCESS_V2);
    if (v2 && v2.processes.length > 0) {
      processV2 = 'works';
      return v2;
    }
    // It read them before: this sample failed, not the counterset.
    if (processV2 === 'works') throw new Error(`no process counters in its output: ${excerpt(output)}`);
    processV2 = 'rejected';
    note(`[process-memory] typeperf turned down the Process V2 counters (Windows 10 has none), so processes are listed from the Process counters, and samples that mix up processes are skipped: ${excerpt(output) || 'no output'}`);
  }
  const output = await typeperf(run, PROCESS_LEGACY);
  const legacy = parseTypeperf(output, PROCESS_LEGACY);
  if (!legacy || legacy.processes.length === 0) throw new Error(`no process counters in its output: ${excerpt(output)}`);
  return legacy;
}

/**
 * Measure the agents' processes (and the dev server's), for the health line.
 * Null on any platform but Windows, and when the process list can't be had:
 * the agent host isn't up, typeperf failed or timed out, or printed no
 * sample. SKIPPED when the sample didn't hold together (inconsistency()).
 * Never throws.
 */
export async function measureProcesses(opts: MeasureOptions): Promise<ProcessMemory | SkippedSample | null> {
  if ((opts.platform ?? process.platform) !== 'win32') return null;
  const run = opts.run ?? runInAgentHost;
  const note = opts.note ?? ((line: string) => logger.info(line));
  try {
    const { processes, problem: printed } = await sample(run, note);
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
    return {
      agents: agentProcesses(processes, roots, hostPid),
      devServer: opts.devServer && opts.main ? devServerProcesses(processes, opts.main.pid) : null,
    };
  } catch (e) {
    if (!notedFailure) {
      notedFailure = true;
      note(`[process-memory] Couldn't list processes with typeperf, so the health line leaves out the agents' memory: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

/** Forget what was noted, and whether Windows has Process V2. */
export function resetForTests(): void {
  processV2 = 'unknown';
  notedFailure = false;
  notedSkip = false;
}
