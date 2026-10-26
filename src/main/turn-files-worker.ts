/**
 * The watcher thread: a worker thread of the main process that runs the
 * worktree watches turns use (turn-files-watcher.ts), so libuv's work on each
 * change a watch reports runs on this thread's event loop, not the main
 * process's. Built as its own entry (vite.main.config.mjs).
 *
 * Only Node and the watch service here: a worker thread has no Electron
 * `app`, so the main process's modules (the logger, settings) can't load in it.
 */
import { parentPort } from 'node:worker_threads';
import { createWatchService, isWatchRequest, type WatchMessage } from './turn-files-watcher.js';

if (parentPort) {
  const port = parentPort;
  const service = createWatchService({ post: (message) => port.postMessage(message) });
  port.on('message', (data: unknown) => {
    if (isWatchRequest(data)) service.handle(data);
  });
  port.postMessage({ type: 'ready' } satisfies WatchMessage);
}
