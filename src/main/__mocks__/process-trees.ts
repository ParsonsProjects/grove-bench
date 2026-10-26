import { readFileSync } from 'node:fs';

/**
 * A process tree to kill, for tests that kill real processes: run with
 * `node -e`, it starts a child that waits, prints the child's pid, and
 * waits itself.
 */
export const TREE_SCRIPT = [
  "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
  'console.log(c.pid);',
  'setInterval(() => {}, 1000);',
].join(' ');

/** Whether `pid` is still running: not gone, and (on Linux) not a zombie
 *  waiting for a parent that may never reap it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') return true;
  try {
    // The state follows the command name in brackets: "123 (node) Z ...".
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}
