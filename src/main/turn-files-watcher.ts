/**
 * The worktree watches behind turn-files.ts. They run in a worker thread of
 * their own (turn-files-worker.ts), or in the main process when that thread
 * can't run.
 *
 * On Windows, libuv handles each change a recursive watch reports on the
 * thread whose event loop holds the watch, and for every one but a delete it
 * first asks Windows for the path's long form (GetLongPathNameW in libuv's
 * src/win/fs-event.c), which reads the disk. Watched from the main process,
 * every file a running turn's agent touched cost the main process that: an
 * install's thousands in node_modules, git's own files, a build's output,
 * and files only read where last-access times are kept (libuv asks for
 * those changes too). With several turns running, the window waited on it.
 * In the watcher thread the cost is that thread's, and the main process gets
 * only the paths a turn could list, a batch at a time, and a count of every
 * change for the freeze log.
 *
 * Turns in the same folder (threads in the project's own checkout) share one
 * watch. Only Node here: a worker thread has no Electron `app`, so the logger
 * and the freeze log can't load in it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { madeFileKind } from '../shared/attachments.js';

/** Folders of dependencies, caches and compiled output, skipped wherever they
 *  are. `out` and `build` are not: scripts save reports and screenshots there
 *  as often as builds write to them. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.cache', '.parcel-cache', '.vite', '.gradle', 'dist', 'target', 'bin', 'obj', 'coverage',
]);

/** How many changed paths a turn notes. A turn that churns more than this
 *  stops noting new ones; the list is a convenience, not a record. */
export const MAX_CANDIDATES = 2000;

/** How long changes gather before they are sent, as one message. */
export const BATCH_MS = 100;

/** Whether a changed path is one a turn's list could hold: a kind it shows,
 *  outside the skipped folders. */
export function isListable(relPath: string): boolean {
  if (!madeFileKind(relPath)) return false;
  const dirs = relPath.split(/[\\/]/).slice(0, -1);
  return !dirs.some((d) => SKIPPED_DIRS.has(d.toLowerCase()));
}

/** What the main process asks: watch `root` for a turn, or stop. */
export type WatchRequest =
  | { type: 'watch'; id: number; root: string }
  | { type: 'unwatch'; id: number };

/**
 * What the watches send back. `ready`: the watcher thread has loaded (the
 * first thing it posts). `changes`: how many changes they saw since the
 * last batch (all of them, listable or not), and for each watch the paths
 * relative to its root it hasn't sent before that a turn could list.
 * `unwatched` answers an unwatch, after every path seen for it. `error`: the
 * watch couldn't start or has failed, and nothing more comes for it.
 */
export type WatchMessage =
  | { type: 'ready' }
  | { type: 'changes'; count: number; paths: [id: number, paths: string[]][] }
  | { type: 'unwatched'; id: number }
  | { type: 'error'; id: number; message: string };

/** A recursive watch on `root`, calling `onChange` with each change's path
 *  relative to it (null when the OS doesn't say). */
export type WatchTreeFn = (root: string, onChange: (relPath: string | null) => void) => {
  close(): void;
  on(event: 'error', listener: (err: unknown) => void): unknown;
};

/** fs.watch over the whole tree: native on Windows (and macOS). */
const watchTree: WatchTreeFn = (root, onChange) =>
  fs.watch(root, { recursive: true }, (_event, filename) => onChange(filename));

export interface WatchServiceOptions {
  post: (message: WatchMessage) => void;
  watch?: WatchTreeFn;
  platform?: NodeJS.Platform;
  batchMs?: number;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createWatchService({ post, watch = watchTree, platform = process.platform, batchMs = BATCH_MS }: WatchServiceOptions) {
  /** A folder being watched, and the turns watching it. */
  interface Root {
    watcher: { close(): void };
    ids: Set<number>;
  }
  /** A turn's watch: the paths it has been sent, and those waiting to be. */
  interface Watch {
    key: string;
    seen: Set<string>;
    pending: string[];
  }
  const roots = new Map<string, Root>();
  const watches = new Map<number, Watch>();
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Windows paths match whatever their case. */
  const keyOf = (root: string) => (platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root));

  /** Send what has gathered, if anything. */
  function send(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const paths: [number, string[]][] = [];
    for (const [id, w] of watches) {
      if (w.pending.length === 0) continue;
      paths.push([id, w.pending]);
      w.pending = [];
    }
    if (count === 0 && paths.length === 0) return;
    post({ type: 'changes', count, paths });
    count = 0;
  }

  function changed(root: Root, relPath: string | null): void {
    count++;
    if (relPath && isListable(relPath)) {
      for (const id of root.ids) {
        const w = watches.get(id);
        if (!w || w.seen.has(relPath) || w.seen.size >= MAX_CANDIDATES) continue;
        w.seen.add(relPath);
        w.pending.push(relPath);
      }
    }
    timer ??= setTimeout(send, batchMs);
  }

  function closeRoot(key: string): void {
    const root = roots.get(key);
    if (!root) return;
    roots.delete(key);
    try { root.watcher.close(); } catch { /* already closed */ }
  }

  /** The watch on `key` failed: its turns get what it saw, then the error. */
  function failed(key: string, err: unknown): void {
    const root = roots.get(key);
    if (!root) return;
    send();
    closeRoot(key);
    for (const id of root.ids) {
      watches.delete(id);
      post({ type: 'error', id, message: messageOf(err) });
    }
  }

  function start(id: number, rootPath: string): void {
    const key = keyOf(rootPath);
    let root = roots.get(key);
    if (!root) {
      const created: Root = { watcher: { close() {} }, ids: new Set() };
      try {
        const watcher = watch(rootPath, (relPath) => changed(created, relPath));
        watcher.on('error', (err) => failed(key, err));
        created.watcher = watcher;
      } catch (err) {
        // The folder is gone, or the OS refused the watch: no list this turn.
        post({ type: 'error', id, message: messageOf(err) });
        return;
      }
      roots.set(key, created);
      root = created;
    }
    root.ids.add(id);
    watches.set(id, { key, seen: new Set(), pending: [] });
  }

  function stop(id: number): void {
    const w = watches.get(id);
    if (w) {
      // What it saw goes first: the turn lists its files once this answers.
      if (w.pending.length > 0) send();
      watches.delete(id);
      const root = roots.get(w.key);
      root?.ids.delete(id);
      if (root?.ids.size === 0) closeRoot(w.key);
    }
    post({ type: 'unwatched', id });
  }

  return {
    handle(request: WatchRequest): void {
      if (request.type === 'watch') start(request.id, request.root);
      else stop(request.id);
    },
    /** How many folders are watched (for tests). */
    watchedFolders: () => roots.size,
  };
}

/** Whether `value` is a request the watches can take. */
export function isWatchRequest(value: unknown): value is WatchRequest {
  const r = value as Partial<{ type: unknown; id: unknown; root: unknown }> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'number') return false;
  return r.type === 'unwatch' || (r.type === 'watch' && typeof r.root === 'string');
}

/** Whether `value` is a message from the watches. */
export function isWatchMessage(value: unknown): value is WatchMessage {
  const m = value as Partial<{ type: unknown; id: unknown; count: unknown; paths: unknown; message: unknown }> | null;
  if (!m || typeof m !== 'object') return false;
  if (m.type === 'ready') return true;
  if (m.type === 'changes') return typeof m.count === 'number' && Array.isArray(m.paths);
  if (m.type === 'unwatched') return typeof m.id === 'number';
  return m.type === 'error' && typeof m.id === 'number' && typeof m.message === 'string';
}
