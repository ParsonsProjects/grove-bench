/**
 * The process host's own process: an Electron utility process that runs git
 * and gh for the main process (process-host.ts) and posts back what they
 * printed. Built as its own entry (vite.main.config.mjs).
 *
 * Only execa and the protocol here. A utility process has no `app`, so the
 * main process's modules (the logger, settings) can't load in it.
 */
import { execa } from 'execa';
import { HOST_READY, isHostRequest, runRequest, serializeError, type HostStarted } from './process-host-protocol.js';

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

if (parentPort) {
  const port = parentPort;
  port.on('message', ({ data }) => {
    if (!isHostRequest(data)) return;
    const started = (pid: number) => port.postMessage({ type: 'started', id: data.id, pid } satisfies HostStarted);
    void runRequest(data, (file, args, options) => execa(file, args, options), undefined, started).then((reply) => {
      try {
        port.postMessage(reply);
      } catch (e) {
        // The main process waits for every id, so a reply that can't be
        // sent still gets an answer.
        port.postMessage({ id: data.id, ok: false, error: serializeError(e), launchMs: reply.launchMs });
      }
    });
  });
  port.postMessage(HOST_READY);
}
