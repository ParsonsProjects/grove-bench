/**
 * Deletes worktree folders that removed threads leave behind (moved aside
 * by WorktreeManager.remove, or left for the sweep) in the delete thread
 * (remove-tree-worker.ts), one at a time. There a big node_modules goes
 * without the main process's event loop or its libuv threads, and with
 * Electron's asar support off, so a .asar file inside is deleted as the
 * file it is (remove-tree-worker.ts says why).
 *
 * When the thread isn't built (tests run the sources), or has stopped
 * MAX_THREAD_FAILURES times, folders are deleted in this process instead,
 * still one at a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { logger } from './logger.js';
import { removeDirectoryWithRetry } from './fs-utils.js';
import { isRemoveMessage, type RemoveRequest } from './remove-tree-protocol.js';

/** The delete thread's file name next to the main bundle (vite.main.config.mjs). */
const WORKER_BUNDLE_NAME = 'remove-tree-worker.js';
/** After the thread has stopped this many times, folders are deleted here. */
export const MAX_THREAD_FAILURES = 3;

export interface RemovePort {
  postMessage(request: RemoveRequest): void;
}

/** Start the delete thread, handing what it posts to `onMessage`, and why it
 *  stopped to `onExit`. Throws when it can't start at all. */
export type StartThread = (onMessage: (message: unknown) => void, onExit: (reason: unknown) => void) => RemovePort;

const startWorkerThread: StartThread = (onMessage, onExit) => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), WORKER_BUNDLE_NAME);
  // Not built (tests run the sources): folders are deleted here instead.
  if (!fs.existsSync(script)) throw new Error(`${WORKER_BUNDLE_NAME} isn't next to the main bundle`);
  const worker = new Worker(script);
  // A delete never keeps the app from quitting: the sweep finishes it.
  worker.unref();
  let error: unknown;
  worker.on('message', onMessage);
  worker.on('error', (err) => { error = err; });
  worker.on('exit', (code) => onExit(error ?? new Error(`The delete thread stopped (exit code ${code})`)));
  return worker;
};

export interface RemoveTreeOptions {
  startThread?: StartThread;
  /** How a folder is deleted in this process. */
  removeHere?: (dir: string) => Promise<void>;
}

/** Make a `removeTree`: delete a folder and all in it; rejects with why not. */
export function createRemoveTree({
  startThread = startWorkerThread,
  removeHere = removeDirectoryWithRetry,
}: RemoveTreeOptions = {}): (dir: string) => Promise<void> {
  let thread: RemovePort | null = null;
  let failures = 0;
  let nextId = 1;
  const pending = new Map<number, { path: string; resolve: () => void; reject: (err: Error) => void }>();
  /** Deletes run here one after another, as the thread runs them. */
  let hereQueue: Promise<unknown> = Promise.resolve();

  function runHere(dir: string): Promise<void> {
    const run = hereQueue.then(() => removeHere(dir));
    hereQueue = run.catch(() => {});
    return run;
  }

  function onMessage(data: unknown): void {
    if (!isRemoveMessage(data)) return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.type === 'done') request.resolve();
    else request.reject(Object.assign(new Error(data.message), data.code ? { code: data.code } : {}));
  }

  function onExit(reason: unknown): void {
    thread = null;
    failures++;
    const here = failures >= MAX_THREAD_FAILURES ? '; folders are deleted in the main process from now on' : '';
    logger.warn(`[remove-tree] The delete thread stopped${here}: ${String(reason)}`);
    // What it hadn't finished is deleted here.
    const left = [...pending.values()];
    pending.clear();
    for (const request of left) runHere(request.path).then(request.resolve, request.reject);
  }

  function threadToUse(): RemovePort | null {
    if (thread || failures >= MAX_THREAD_FAILURES) return thread;
    try {
      thread = startThread(onMessage, onExit);
    } catch (e) {
      failures = MAX_THREAD_FAILURES;
      logger.info(`[remove-tree] No delete thread (${String(e)}); folders are deleted in the main process`);
    }
    return thread;
  }

  return (dir) => {
    const port = threadToUse();
    if (!port) return runHere(dir);
    return new Promise<void>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { path: dir, resolve, reject });
      port.postMessage({ id, path: dir });
    });
  };
}

/** Delete a folder and all in it, in the delete thread; rejects with why not. */
export const removeTree = createRemoveTree();
