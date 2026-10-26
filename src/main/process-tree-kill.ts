import path from 'node:path';
import type { ProcessResult } from './process-host-protocol.js';

/**
 * Killing a process and everything it started, for the main process
 * (process-tree.ts, and processes started there while the agent host is
 * down) and for the agent host, which kills the trees of the processes it
 * started while it still holds them (HostedProcess.killTree,
 * process-host-spawn.ts).
 *
 * Killing only the parent is not enough. On Windows a child outlives its
 * parent and keeps its listening ports and file handles open; on POSIX it
 * is re-parented to init and keeps running. Either way it can no longer be
 * traced back to its parent, so a tree is killed from its root while the
 * root is still running.
 *
 * Nothing here may start PowerShell. AVG and Avast's behaviour shield
 * (IDP.HELU.PSE*) treats a hidden PowerShell started by electron.exe as
 * malware: it kills the app and quarantines electron.exe. On Windows the
 * killing is done by taskkill, which ships with Windows and walks the tree
 * itself.
 *
 * Only Node here: the agent host has no `app`, so nothing here logs. What
 * went wrong is returned, for the caller to log or send on.
 */

export interface ProcessEntry {
  pid: number;
  ppid: number;
}

/** Run a command to its end: execa with `reject: false`, which resolves
 *  however the command exits, or runProcess. It rejects only when the
 *  command couldn't run. */
export type RunCommand = (file: string, args: string[], options: { timeout: number; reject: false }) => Promise<ProcessResult>;

const KILL_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;

/** Kill `pid` and every process under it. Resolves with why it failed, if
 *  it did. `pid` must still be the caller's process (it holds a handle to
 *  it, or has not seen it exit): Windows hands an exited process's PID to
 *  the next process it starts. `list` lists the processes off Windows. */
export async function killTreeWith(
  pid: number,
  run: RunCommand,
  list: () => Promise<ProcessEntry[]> = () => listProcessesWith(run),
): Promise<string | undefined> {
  if (!isKillable(pid)) return undefined;
  if (process.platform === 'win32') return taskkillWith([pid], run);
  let table: ProcessEntry[] = [];
  let failure: string | undefined;
  try {
    table = await list();
  } catch (e) {
    failure = `couldn't list processes, so only ${pid} was killed: ${messageOf(e)}`;
  }
  const tree = treeOf(table, pid);
  killPids(tree.length > 0 ? tree.map((p) => p.pid) : [pid]);
  return failure;
}

/** taskkill each of `pids` with everything under it. Resolves with why it
 *  failed, if it did. */
export async function taskkillWith(pids: number[], run: RunCommand): Promise<string | undefined> {
  if (pids.length === 0) return undefined;
  // Full path, so a taskkill.exe in the worktree or on PATH can't stand in.
  const exe = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  const args = [...pids.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F'];
  let result: ProcessResult;
  try {
    result = await run(exe, args, { timeout: KILL_TIMEOUT_MS, reject: false });
  } catch (e) {
    return `taskkill ${pids.join(', ')} failed: ${messageOf(e)}`;
  }
  // 128: one of them had already exited.
  if (!result.failed || result.exitCode === 128) return undefined;
  const why = result.stderr || (result.timedOut ? 'timed out' : `exit code ${result.exitCode ?? 'none'}`);
  return `taskkill ${pids.join(', ')} failed: ${why}`;
}

/** Every process on the machine, from `ps` (POSIX only). Rejects when the
 *  process table can't be read. */
export async function listProcessesWith(run: RunCommand): Promise<ProcessEntry[]> {
  const result = await run('ps', ['-A', '-o', 'pid=,ppid='], { timeout: LIST_TIMEOUT_MS, reject: false });
  if (result.failed) throw new Error(result.stderr || (result.timedOut ? 'ps timed out' : `ps exited with code ${result.exitCode ?? 'none'}`));
  return parseProcessList(result.stdout);
}

/** Parse `pid ppid` lines. */
export function parseProcessList(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    entries.push({ pid, ppid });
  }
  return entries;
}

/** `rootPid` and every process under it in `table`, parents before children.
 *  Empty when the root isn't in the table. `isChild` can turn down a process
 *  that names a parent which can't be it (one started after it, whose PID
 *  Windows reused). */
export function treeOf<T extends ProcessEntry>(
  table: T[],
  rootPid: number,
  isChild: (child: T, parent: T) => boolean = () => true,
): T[] {
  const root = table.find((p) => p.pid === rootPid);
  if (!root) return [];
  const childrenOf = new Map<number, T[]>();
  for (const p of table) {
    const siblings = childrenOf.get(p.ppid);
    if (siblings) siblings.push(p);
    else childrenOf.set(p.ppid, [p]);
  }
  const tree = [root];
  const seen = new Set([root.pid]);
  for (let i = 0; i < tree.length; i++) {
    for (const child of childrenOf.get(tree[i].pid) ?? []) {
      if (seen.has(child.pid) || !isChild(child, tree[i])) continue;
      seen.add(child.pid);
      tree.push(child);
    }
  }
  return tree;
}

/** Never this process, or PID 0, which on POSIX signals our own process group. */
export function isKillable(pid: number): boolean {
  return pid > 0 && pid !== process.pid;
}

/** Parents go first so a supervisor (nodemon, concurrently) can't respawn a
 *  child between the two kills. */
export function killPids(pids: number[]): void {
  for (const pid of pids) {
    if (!isKillable(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* already gone, or not ours to kill */ }
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
