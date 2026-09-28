import { execa } from 'execa';
import { logger } from './logger.js';

/**
 * Find and kill the processes a conversation started.
 *
 * Closing a conversation has to stop its terminal shell and agent process and
 * everything those launched: dev servers, watchers, test runners. Killing only
 * the parent is not enough. On Windows a child outlives its parent and keeps
 * its listening ports and file handles open; on POSIX it is re-parented to
 * init and keeps running.
 */

export interface ProcessEntry {
  pid: number;
  ppid: number;
  /** Start time in ms, Windows only. Windows reuses PIDs and never re-parents
   *  orphans, so an orphan's ppid can name a newer, unrelated process. A
   *  parent/child link is only trusted when the child started after the
   *  parent. Undefined on POSIX, where orphans are re-parented at once. */
  startedAt?: number;
}

const LIST_TIMEOUT_MS = 10_000;

// Get-CimInstance rather than wmic, which recent Windows builds no longer ship.
// Start times are FILETIME ticks (100 ns) cut to ms to stay a safe integer.
const WIN_LIST_SCRIPT = `
Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object {
  $started = if ($_.CreationDate) { [long][math]::Floor($_.CreationDate.ToFileTimeUtc() / 10000) } else { 0 }
  '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $started
}`;

let inflight: Promise<ProcessEntry[]> | null = null;

/** Every process on the machine. Empty when the process table can't be read.
 *  Concurrent callers (every conversation closing at app quit) share one query. */
export function listProcesses(): Promise<ProcessEntry[]> {
  inflight ??= queryProcesses().finally(() => { inflight = null; });
  return inflight;
}

async function queryProcesses(): Promise<ProcessEntry[]> {
  try {
    const { stdout } = process.platform === 'win32'
      ? await execa('powershell.exe', [
          '-NoProfile', '-NonInteractive',
          // Encoded so the script needs no command-line quoting.
          '-EncodedCommand', Buffer.from(WIN_LIST_SCRIPT, 'utf16le').toString('base64'),
        ], { windowsHide: true, timeout: LIST_TIMEOUT_MS })
      : await execa('ps', ['-A', '-o', 'pid=,ppid='], { timeout: LIST_TIMEOUT_MS });
    return parseProcessList(stdout);
  } catch (err) {
    logger.warn('[process-tree] could not list processes:', err);
    return [];
  }
}

/** Parse `pid ppid [startedAt]` lines. */
export function parseProcessList(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, ppid, startedAt] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    entries.push(startedAt > 0 ? { pid, ppid, startedAt } : { pid, ppid });
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
    const parent = tree[i];
    for (const child of childrenOf.get(parent.pid) ?? []) {
      if (seen.has(child.pid)) continue;
      if (child.startedAt !== undefined && parent.startedAt !== undefined && child.startedAt < parent.startedAt) continue;
      seen.add(child.pid);
      tree.push(child);
    }
  }
  return tree;
}

/** `rootPid` and everything under it right now. When the process table can't
 *  be read this falls back to the root alone, so it can still be killed. */
export async function snapshotTree(rootPid: number): Promise<ProcessEntry[]> {
  const table = await listProcesses();
  if (table.length === 0) return [{ pid: rootPid, ppid: 0 }];
  return treeOf(table, rootPid);
}

/** Whether `pid` is a running process. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Poll until `pid` exits or `timeoutMs` passes. Resolves whether it exited. */
export async function waitForExit(pid: number, timeoutMs: number, pollMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isRunning(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return true;
}

/** Kill every process under `pid`, leaving `pid` itself to its owner (a
 *  PTY is torn down through node-pty). Returns the PIDs it targeted. */
export async function killDescendants(pid: number): Promise<number[]> {
  const table = await listProcesses();
  const pids = treeOf(table, pid).slice(1).map((p) => p.pid);
  killPids(pids);
  return pids;
}

/**
 * Kill whatever from an earlier `snapshotTree` is still running, plus anything
 * those processes started since. A PID that now belongs to a different process
 * (same PID, different start time) is left alone. Returns the PIDs it targeted.
 */
export async function killSurvivors(snapshot: ProcessEntry[]): Promise<number[]> {
  const alive = snapshot.filter((p) => isRunning(p.pid));
  if (alive.length === 0) return [];

  const table = await listProcesses();
  const targets = new Set<number>();
  for (const before of alive) {
    if (table.length === 0) {
      // Can't verify or find new children; kill what we already know about.
      targets.add(before.pid);
      continue;
    }
    const now = table.find((p) => p.pid === before.pid);
    if (!now || (before.startedAt !== undefined && now.startedAt !== before.startedAt)) continue;
    for (const p of treeOf(table, before.pid)) targets.add(p.pid);
  }
  const pids = [...targets];
  killPids(pids);
  return pids;
}

/** Parents go first so a supervisor (nodemon, concurrently) can't respawn a
 *  child between the two kills. On Windows Node maps SIGKILL to
 *  TerminateProcess. */
function killPids(pids: number[]): void {
  for (const pid of pids) {
    // PID 0 would signal our own process group.
    if (pid <= 0 || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch { /* already gone, or not ours to kill */ }
  }
}
