import path from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { logger } from './logger.js';
import { runProcess } from './process-host.js';
import {
  isKillable, killPids, listProcessesWith, taskkillWith, treeOf, type ProcessEntry, type RunCommand,
} from './process-tree-kill.js';

/**
 * Kill what runs in a terminal (killDescendants), from the main process. How
 * a tree is killed, and why taskkill, is in process-tree-kill.ts; an agent's
 * tree is killed by the agent host, which started it (HostedProcess.killTree).
 *
 * taskkill (and ps) start in the process host (runProcess), so a slow launch
 * never freezes the window: they run whenever a terminal closes. At quit
 * they still have the host, which stops only after the threads have closed
 * (will-quit, index.ts); once it has stopped they run here. They never wait
 * for a host that is starting or restarting (`urgent`): the processes keep
 * running until they are killed, so they run here then. Killing is safe to
 * repeat (`idempotent`): if the host dies, stops answering or stops (at quit)
 * while taskkill runs, it runs again in the main process.
 */

const LIST_TIMEOUT_MS = 10_000;

/** taskkill and ps in the process host, never waiting for it. */
const run: RunCommand = (file, args, options) => runProcess(file, args, { ...options, idempotent: true, urgent: true });

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
    const failure = await taskkillWith(roots, run);
    if (failure) logger.warn(`[process-tree] ${failure}`);
    return roots;
  }
  const pids = treeOf(await listProcesses(), shellPid).slice(1).map((p) => p.pid);
  killPids(pids);
  return pids;
}

/**
 * PIDs attached to a ConPTY shell's console. node-pty lists them the same way
 * when it kills a PTY: its helper script attaches to the console, which it has
 * to do from a process of its own. Empty when the console can't be read.
 *
 * Forked here, not in the process host: the helper answers over a Node IPC
 * channel (process.send), which the host's commands don't carry, and
 * node-pty forks the same helper from here anyway when it kills the PTY.
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
 *  process table can't be read. Concurrent callers (every terminal closing
 *  at app quit) share one query. */
export function listProcesses(): Promise<ProcessEntry[]> {
  inflight ??= queryProcesses().finally(() => { inflight = null; });
  return inflight;
}

async function queryProcesses(): Promise<ProcessEntry[]> {
  try {
    return await listProcessesWith(run);
  } catch (err) {
    logger.warn('[process-tree] could not list processes:', err);
    return [];
  }
}
