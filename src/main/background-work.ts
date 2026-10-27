/**
 * Background work: the git and gh calls the app makes on its own to keep
 * what it shows current (git status, a branch's sync and PR status, which
 * branch a thread is on), rather than because someone clicked something.
 * The IPC handlers that do it run inside `inBackground`, and every command
 * they start is marked for runProcess and runInAgentHost, however deep in
 * git.ts it is started: such a command never runs in the main process
 * while its host is down. It waits for the host, or is skipped, and its
 * caller keeps what it showed last. On 27 Oct, with the host down on a
 * busy PC, each git launch in the main process froze the window, for up
 * to 42 s.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const background = new AsyncLocalStorage<true>();

/** Run `work` as background work: the commands it starts are marked. */
export function inBackground<T>(work: () => Promise<T>): Promise<T> {
  return background.run(true, work);
}

/** Whether the code running now is background work. */
export function isBackground(): boolean {
  return background.getStore() === true;
}
