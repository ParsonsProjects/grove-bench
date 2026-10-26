/**
 * The files an agent makes in a turn: created or changed in its worktree
 * while the turn runs, by any route (a script it runs in Bash, an MCP tool,
 * Write). A watcher on the worktree notes the paths that change; at the end
 * of the turn the ones still there, changed since the turn began, and of a
 * kind worth looking at (images, PDFs, web pages, media, spreadsheets,
 * documents: madeFileKind) are reported, and the thread lists them.
 *
 * Files outside the worktree (a temp folder) aren't seen. Those that only an
 * install or a compile would write (dependencies, caches, `dist`) are
 * skipped, so `npm run build` doesn't list every asset it copies there.
 *
 * The watches run in a worker thread (turn-files-watcher.ts says why), which
 * sends this process only the paths a turn could list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { MadeFileKind } from '../shared/types.js';
import { madeFileKind } from '../shared/attachments.js';
import { freezeLog } from './freeze-log.js';
import { logger } from './logger.js';
import {
  MAX_CANDIDATES, createWatchService, isListable, isWatchMessage, type WatchMessage, type WatchRequest,
} from './turn-files-watcher.js';
import { within } from './within.js';

/** How many files a turn lists; the rest are counted. */
export const MAX_LISTED = 24;
/** File times can trail the clock: FAT keeps them to 2 seconds. */
const CLOCK_SLACK_MS = 2000;

/** Watch `root` for a turn. `close` stops it, and settles once every change
 *  seen before has reached `onChange`. */
export type WatchFn = (root: string, onChange: (relPath: string) => void, onError: (err: unknown) => void) => { close(): void | Promise<void> };
type StatFn = (p: string) => Promise<Pick<fs.Stats, 'isFile' | 'size' | 'mtimeMs' | 'birthtimeMs'>>;

/** The watcher thread's file name next to the main bundle (vite.main.config.mjs). */
export const WORKER_BUNDLE_NAME = 'turn-files-worker.js';
/** After the watcher thread has stopped this many times, the watches run in
 *  the main process for the rest of the run. */
export const MAX_THREAD_FAILURES = 3;
/** The longest the end of a turn waits for the watcher thread to send the
 *  paths it still holds for it. It sends them within BATCH_MS. */
export const UNWATCH_WAIT_MS = 2_000;

/** Where the watches run: the watcher thread, or (when it can't) the main
 *  process. */
export interface WatchPort {
  postMessage(request: WatchRequest): void;
}

/** Start the watcher thread, handing what it posts to `onMessage`, and why it
 *  stopped to `onExit` (it failed to load, or crashed). Throws when it can't
 *  start at all. Requests posted before it has loaded wait for it. */
export type StartThread = (onMessage: (message: unknown) => void, onExit: (reason: unknown) => void) => WatchPort;

const startWorkerThread: StartThread = (onMessage, onExit) => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), WORKER_BUNDLE_NAME);
  // Not built (tests run the sources): the watches run here instead.
  if (!fs.existsSync(script)) throw new Error(`${WORKER_BUNDLE_NAME} isn't next to the main bundle`);
  const worker = new Worker(script);
  // A watch must never keep the app from quitting.
  worker.unref();
  let error: unknown;
  worker.on('message', onMessage);
  worker.on('error', (err) => { error = err; });
  worker.on('exit', (code) => onExit(error ?? new Error(`The watcher thread stopped (exit code ${code})`)));
  return worker;
};

export interface WatchClientOptions {
  startThread?: StartThread;
  /** Changes the watches saw, for the freeze log. They arrive a batch at a
   *  time (BATCH_MS), so a stall line counts those whose batch came in
   *  during it, not exactly those that happened then. */
  noteChanges?: (count: number) => void;
  unwatchWaitMs?: number;
}

/**
 * Watches for turns, run in the watcher thread, started on the first one.
 * When it can't start or load (its script missing or broken: the turns
 * waiting for it move here), or has stopped MAX_THREAD_FAILURES times after
 * loading, they run in this process as they did before it, through the same
 * service. A turn watching through a thread that stops after loading lists
 * nothing.
 */
export function createWatchClient({
  startThread = startWorkerThread,
  noteChanges = (count) => freezeLog.noteWorktreeChanges(count),
  unwatchWaitMs = UNWATCH_WAIT_MS,
}: WatchClientOptions = {}): WatchFn {
  interface ClientWatch {
    root: string;
    onChange: (relPath: string) => void;
    onError: (err: unknown) => void;
    /** Set once close is asked for: settles when the watch answers. */
    closing?: Promise<void>;
    unwatched?: () => void;
  }
  const watches = new Map<number, ClientWatch>();
  let nextId = 1;
  let thread: WatchPort | null = null;
  /** The thread has posted `ready`. */
  let loaded = false;
  let inProcess: WatchPort | null = null;
  let failures = 0;

  function receive(message: unknown): void {
    if (!isWatchMessage(message)) return;
    handleMessage(message);
  }

  function handleMessage(message: WatchMessage): void {
    if (message.type === 'ready') {
      loaded = true;
      return;
    }
    if (message.type === 'changes') {
      if (message.count > 0) noteChanges(message.count);
      for (const [id, paths] of message.paths) {
        const w = watches.get(id);
        if (w) for (const p of paths) w.onChange(p);
      }
      return;
    }
    const w = watches.get(message.id);
    if (!w) return;
    watches.delete(message.id);
    w.unwatched?.();
    if (message.type === 'error') w.onError(new Error(message.message));
  }

  function runHere(why: unknown): WatchPort {
    logger.warn('[turn-files] watching worktrees in the main process: the watcher thread can\'t run:', why);
    const service = createWatchService({ post: handleMessage });
    inProcess = { postMessage: (request) => service.handle(request) };
    return inProcess;
  }

  function exited(reason: unknown): void {
    const ran = loaded;
    thread = null;
    loaded = false;
    if (!ran) {
      // It never loaded, and won't next time: watch here, these turns too.
      const here = runHere(reason);
      for (const [id, w] of watches) {
        if (w.closing) {
          watches.delete(id);
          w.unwatched?.();
        } else {
          here.postMessage({ type: 'watch', id, root: w.root });
        }
      }
      return;
    }
    failures++;
    logger.warn(`[turn-files] the watcher thread stopped (${failures} of ${MAX_THREAD_FAILURES}):`, reason);
    for (const [id, w] of watches) {
      watches.delete(id);
      w.unwatched?.();
      w.onError(reason);
    }
  }

  function port(): WatchPort {
    if (inProcess) return inProcess;
    if (thread) return thread;
    if (failures >= MAX_THREAD_FAILURES) return runHere(`it stopped ${failures} times`);
    try {
      thread = startThread(receive, exited);
      return thread;
    } catch (err) {
      return runHere(err);
    }
  }

  return (root, onChange, onError) => {
    const id = nextId++;
    const watch: ClientWatch = { root, onChange, onError };
    watches.set(id, watch);
    port().postMessage({ type: 'watch', id, root });
    return {
      close: () => {
        // Answered already: it failed, or its thread stopped.
        if (!watches.has(id)) return Promise.resolve();
        watch.closing ??= (async () => {
          const answered = new Promise<void>((resolve) => { watch.unwatched = resolve; });
          port().postMessage({ type: 'unwatch', id });
          if (!(await within(answered, unwatchWaitMs))) watches.delete(id);
        })();
        return watch.closing;
      },
    };
  };
}

const watchInThread = createWatchClient();

export interface FoundFile {
  /** Relative to the worktree, with forward slashes. */
  path: string;
  /** Absolute, to read it from. */
  absPath: string;
  kind: MadeFileKind;
  size: number;
}

export class TurnFiles {
  private readonly candidates = new Set<string>();
  /** Files the agent edited in place, keyed by caseKey. */
  private readonly edited = new Set<string>();
  private watcher: ReturnType<WatchFn> | null = null;
  private readonly stat: StatFn;
  private readonly platform: NodeJS.Platform;

  constructor(
    private readonly root: string,
    private readonly startedAt = Date.now(),
    opts: { watch?: WatchFn; stat?: StatFn; platform?: NodeJS.Platform } = {},
  ) {
    this.stat = opts.stat ?? ((p) => fs.promises.lstat(p));
    this.platform = opts.platform ?? process.platform;
    try {
      this.watcher = (opts.watch ?? watchInThread)(root, (rel) => this.note(rel), (err) => {
        logger.debug(`[turn-files] stopped watching ${root}:`, err);
        this.close();
      });
    } catch (err) {
      // No list this turn (the folder is gone, or the OS refused the watch).
      logger.debug(`[turn-files] could not watch ${root}:`, err);
    }
  }

  /** Windows paths match whatever their case. */
  private caseKey(absPath: string): string {
    return this.platform === 'win32' ? absPath.toLowerCase() : absPath;
  }

  private note(relPath: string): void {
    if (this.candidates.size >= MAX_CANDIDATES || !isListable(relPath)) return;
    this.candidates.add(path.normalize(relPath));
  }

  /** A file the agent edited in place (Edit, not Write), so it was there
   *  before the turn: a web page changed that way is source, not output. */
  noteEdited(filePath: string): void {
    this.edited.add(this.caseKey(path.resolve(this.root, filePath)));
  }

  close(): void {
    void this.stopWatching();
  }

  /** Stop watching. Settles once every change seen before is noted. */
  private async stopWatching(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }

  /**
   * Stop watching, and return the files the turn made: still there, not
   * empty, and written since it began (watchers also report files only
   * read). A web page counts only when it is new this turn and wasn't
   * edited in place, so editing a site's pages doesn't list them. Images
   * come first, then by path; past MAX_LISTED they're counted in `more`.
   */
  async finish(): Promise<{ files: FoundFile[]; more: number }> {
    await this.stopWatching();
    const since = this.startedAt - CLOCK_SLACK_MS;
    const found: FoundFile[] = [];
    await Promise.all([...this.candidates].map(async (rel) => {
      const absPath = path.join(this.root, rel);
      const kind = madeFileKind(rel);
      try {
        const st = await this.stat(absPath);
        if (!kind || !st.isFile() || st.size === 0 || st.mtimeMs < since) return;
        if (kind === 'html' && (this.edited.has(this.caseKey(absPath)) || !(st.birthtimeMs >= since))) return;
        found.push({ path: rel.split(path.sep).join('/'), absPath, kind, size: st.size });
      } catch { /* gone again: a temp file */ }
    }));
    found.sort((a, b) => Number(b.kind === 'image') - Number(a.kind === 'image') || a.path.localeCompare(b.path));
    return { files: found.slice(0, MAX_LISTED), more: Math.max(0, found.length - MAX_LISTED) };
  }
}
