/**
 * The delete thread: a worker thread of the main process that deletes the
 * folders removed threads leave behind (remove-tree.ts), one at a time, so
 * a big node_modules goes without the main process's event loop or its
 * libuv threads. Built as its own entry (vite.main.config.mjs).
 *
 * With asar support off. Electron's fs treats every .asar file as a folder
 * of the files packed in it, so a recursive delete of a worktree that holds
 * one (node_modules/electron has some) walks into it and fails. Turning it
 * off for the whole main process could break a module loading from the
 * app's own app.asar meanwhile; a worker thread has its own `process`, so
 * here it changes nothing else. This thread loads nothing after this line.
 *
 * Only Node here: a worker thread has no Electron `app`, so the main
 * process's modules (the logger, settings) can't load in it.
 */
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { handleRemoveRequest, isRemoveRequest } from './remove-tree-protocol.js';

(process as { noAsar?: boolean }).noAsar = true;

/** As removeDirectoryWithRetry: a file Windows briefly holds (antivirus,
 *  the indexer) is tried again, a little later each time. Waiting blocks
 *  only this thread. */
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 } as const;

if (parentPort) {
  const port = parentPort;
  port.on('message', (data: unknown) => {
    if (isRemoveRequest(data)) port.postMessage(handleRemoveRequest(data, (dir) => fs.rmSync(dir, RM_OPTIONS)));
  });
}
