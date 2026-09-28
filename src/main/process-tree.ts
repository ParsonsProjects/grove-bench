import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { execa } from 'execa';
import { logger } from './logger.js';

/**
 * Kill the processes a conversation started.
 *
 * Closing a conversation has to stop its terminal shell and agent process and
 * everything those launched: dev servers, watchers, test runners. Killing only
 * the parent is not enough. On Windows a child outlives its parent and keeps
 * its listening ports and file handles open; on POSIX it is re-parented to
 * init and keeps running. Either way it can no longer be traced back to its
 * parent, so a tree is killed from its root while the root is still running.
 *
 * Nothing here may start PowerShell. AVG and Avast's behaviour shield
 * (IDP.HELU.PSE*) treats a hidden PowerShell started by electron.exe as
 * malware: it kills the app and quarantines electron.exe. On Windows the
 * killing is done by taskkill, which ships with Windows and walks the tree
 * itself.
 */

export interface ProcessEntry {
  pid: number;
  ppid: number;
}

const KILL_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;

/** Kill `pid` and every process under it. `pid` must still be the caller's
 *  process (it holds a handle to it, or has not seen it exit): Windows hands
 *  an exited process's PID to the next process it starts. */
export async function killTree(pid: number): Promise<void> {
  if (!isKillable(pid)) return;
  if (process.platform === 'win32') {
    await taskkill([pid]);
    return;
  }
  const tree = treeOf(await listProcesses(), pid);
  killPids(tree.length > 0 ? tree.map((p) => p.pid) : [pid]);
}

/**
 * Kill everything started from a PTY shell, leaving the shell itself to its
 * owner: node-pty has to close the pseudoconsole while the shell is running,
 * or the console host is left behind. Returns the PIDs whose trees it killed.
 *
 * On Windows those are the processes attached to the shell's console (what
 * runs in it), each killed with everything under it, which catches detached
 * and windowless children that aren't on the console themselves.
 */
export async function killDescendants(shellPid: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const roots = (await consoleProcesses(shellPid)).filter((pid) => pid !== shellPid && isKillable(pid));
    await taskkill(roots);
    return roots;
  }
  const pids = treeOf(await listProcesses(), shellPid).slice(1).map((p) => p.pid);
  killPids(pids);
  return pids;
}

async function taskkill(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  // Full path, so a taskkill.exe in the worktree or on PATH can't stand in.
  const exe = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  const args = [...pids.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F'];
  const result = await execa(exe, args, { windowsHide: true, timeout: KILL_TIMEOUT_MS, reject: false });
  // 128: one of them had already exited.
  if (result.failed && result.exitCode !== 128) {
    logger.warn(`[process-tree] taskkill ${pids.join(', ')} failed:`, result.stderr || result.shortMessage);
  }
}

/**
 * PIDs attached to a ConPTY shell's console. node-pty lists them the same way
 * when it kills a PTY: its helper script attaches to the console, which it has
 * to do from a process of its own. Empty when the console can't be read.
 */
function consoleProcesses(shellPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    let helper: ReturnType<typeof fork>;
    try {
      const agent = path.join(path.dirname(createRequire(import.meta.url).resolve('node-pty')), 'conpty_console_list_agent.js');
      helper = fork(agent, [String(shellPid)], { stdio: 'ignore' });
    } catch (err) {
      logger.warn('[process-tree] could not list console processes:', err);
      resolve([]);
      return;
    }
    const settle = (pids: number[]) => {
      clearTimeout(timer);
      resolve(pids);
    };
    const timer = setTimeout(() => {
      helper.kill();
      settle([]);
    }, LIST_TIMEOUT_MS);
    // The helper is on the console while it asks, so it lists itself.
    helper.once('message', (m: { consoleProcessList?: number[] }) => {
      settle((m.consoleProcessList ?? []).filter((pid) => pid !== helper.pid));
    });
    // 'close' comes after any message, so this only settles a helper that failed.
    helper.once('close', () => settle([]));
    helper.once('error', (err) => {
      logger.warn('[process-tree] console list helper failed:', err);
      settle([]);
    });
  });
}

let inflight: Promise<ProcessEntry[]> | null = null;

/** Every process on the machine, from `ps` (POSIX only). Empty when the
 *  process table can't be read. Concurrent callers (every conversation
 *  closing at app quit) share one query. */
export function listProcesses(): Promise<ProcessEntry[]> {
  inflight ??= queryProcesses().finally(() => { inflight = null; });
  return inflight;
}

async function queryProcesses(): Promise<ProcessEntry[]> {
  try {
    const { stdout } = await execa('ps', ['-A', '-o', 'pid=,ppid='], { timeout: LIST_TIMEOUT_MS });
    return parseProcessList(stdout);
  } catch (err) {
    logger.warn('[process-tree] could not list processes:', err);
    return [];
  }
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
 *  Empty when the root isn't in the table. */
export function treeOf(table: ProcessEntry[], rootPid: number): ProcessEntry[] {
  const root = table.find((p) => p.pid === rootPid);
  if (!root) return [];
  const childrenOf = new Map<number, ProcessEntry[]>();
  for (const p of table) {
    const siblings = childrenOf.get(p.ppid);
    if (siblings) siblings.push(p);
    else childrenOf.set(p.ppid, [p]);
  }
  const tree = [root];
  const seen = new Set([root.pid]);
  for (let i = 0; i < tree.length; i++) {
    for (const child of childrenOf.get(tree[i].pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      tree.push(child);
    }
  }
  return tree;
}

/** Never this process, or PID 0, which on POSIX signals our own process group. */
function isKillable(pid: number): boolean {
  return pid > 0 && pid !== process.pid;
}

/** Parents go first so a supervisor (nodemon, concurrently) can't respawn a
 *  child between the two kills. */
function killPids(pids: number[]): void {
  for (const pid of pids) {
    if (!isKillable(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* already gone, or not ours to kill */ }
  }
}
