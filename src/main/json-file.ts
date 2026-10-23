/**
 * JSON files under userData (settings, app state, credentials).
 *
 * Reads tell a missing file from a damaged one and from one that can't be
 * read right now, so callers never mistake a passing lock for "nothing
 * saved" and write defaults over the real file. Writes replace the file all
 * at once, so a crash mid-write can't leave it truncated.
 *
 * The sync versions hold the main process for the whole read or write,
 * lock retries included. The async ones (readJsonFileAsync, writeFileAtomic)
 * leave the disk work to Node's thread pool and wait between retries with
 * timers, so a slow disk or a long lock blocks nothing.
 */
import fs from 'node:fs';
import { logger } from './logger.js';

export type JsonFileRead =
  | { kind: 'ok'; value: unknown }
  | { kind: 'missing' }
  /** Not valid JSON. A copy is kept at `<file>.corrupt`. */
  | { kind: 'corrupt' }
  /** Exists but couldn't be read, even after riding out brief locks. */
  | { kind: 'unreadable'; error: unknown };

/** Errors Windows raises while another process (antivirus, the indexer, a
 *  backup tool) briefly holds a file. */
const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
/** Short: these block the main process. */
const LOCK_RETRY_DELAYS_MS = [50, 150];
/** The async versions wait with timers, so they can ride out longer locks. */
const ASYNC_LOCK_RETRY_DELAYS_MS = [50, 150, 500, 1000, 2000];

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException)?.code;
}

function isLockError(err: unknown): boolean {
  const code = errorCode(err);
  return !!code && LOCK_CODES.has(code);
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // A thread that may not block (as in a browser's main thread): spin.
    const until = Date.now() + ms;
    while (Date.now() < until) { /* wait */ }
  }
}

function withLockRetrySync<T>(op: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return op();
    } catch (err) {
      if (attempt >= LOCK_RETRY_DELAYS_MS.length || !isLockError(err)) throw err;
      sleepSync(LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Run `op`, trying again after a timer while the file is locked. `stop`
 *  ends the retries early, throwing the last error. */
async function withLockRetry<T>(op: () => Promise<T>, stop: () => boolean = () => false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= ASYNC_LOCK_RETRY_DELAYS_MS.length || !isLockError(err) || stop()) throw err;
      await new Promise((resolve) => setTimeout(resolve, ASYNC_LOCK_RETRY_DELAYS_MS[attempt]));
      if (stop()) throw err;
    }
  }
}

export function readJsonFile(filePath: string): JsonFileRead {
  let text: string;
  try {
    text = withLockRetrySync(() => fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
    logger.warn(`[json-file] could not read ${filePath}:`, error);
    return { kind: 'unreadable', error };
  }
  try {
    return { kind: 'ok', value: JSON.parse(text) };
  } catch {
    // Keep the damaged file before a later save replaces it.
    try { fs.copyFileSync(filePath, `${filePath}.corrupt`); } catch { /* best effort */ }
    logger.warn(`[json-file] ${filePath} is not valid JSON; kept a copy at ${filePath}.corrupt`);
    return { kind: 'corrupt' };
  }
}

/** readJsonFile without blocking: only the JSON parse runs on the calling
 *  thread. */
export async function readJsonFileAsync(filePath: string): Promise<JsonFileRead> {
  let text: string;
  try {
    text = await withLockRetry(() => fs.promises.readFile(filePath, 'utf-8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
    logger.warn(`[json-file] could not read ${filePath}:`, error);
    return { kind: 'unreadable', error };
  }
  try {
    return { kind: 'ok', value: JSON.parse(text) };
  } catch {
    try { await fs.promises.copyFile(filePath, `${filePath}.corrupt`); } catch { /* best effort */ }
    logger.warn(`[json-file] ${filePath} is not valid JSON; kept a copy at ${filePath}.corrupt`);
    return { kind: 'corrupt' };
  }
}

let tempCount = 0;

/** A temp file beside `filePath`, this write's own: a sync write and an
 *  async one can start in the same millisecond. */
function tempPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${++tempCount}.tmp`;
}

/** Write a temp file beside `filePath`, then rename it over the original. */
export function writeFileAtomicSync(filePath: string, data: string, mode?: number): void {
  const tmp = tempPathFor(filePath);
  fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
  try {
    withLockRetrySync(() => fs.renameSync(tmp, filePath));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/** A write started by writeFileAtomic. */
export interface AtomicWrite {
  /** 'written' once the file holds the new data; 'cancelled' when cancel()
   *  stopped it first. Rejects when the write fails, leaving the file as it
   *  was and no temp file behind. */
  readonly done: Promise<'written' | 'cancelled'>;
  /**
   * Stop the write, synchronously, so a sync write can take its place. A
   * rename already handed to the disk is stopped by deleting its temp file:
   * the rename then has nothing to move. True when the write can no longer
   * replace the file after this returns; false when the temp file stayed
   * locked and couldn't be deleted, so its rename may still land.
   */
  cancel(): boolean;
}

/**
 * writeFileAtomicSync without blocking: Node's thread pool writes the temp
 * file and renames it, and a rename blocked by a lock is tried again after a
 * timer. Callers must not start a second write to the same file before the
 * first is done or cancelled, or the two renames could land in either order.
 */
export function writeFileAtomic(filePath: string, data: string, mode?: number): AtomicWrite {
  const tmp = tempPathFor(filePath);
  let cancelled = false;
  const removeTemp = () => fs.promises.rm(tmp, { force: true }).catch(() => { /* best effort */ });
  const done = (async (): Promise<'written' | 'cancelled'> => {
    try {
      await fs.promises.writeFile(tmp, data, mode === undefined ? undefined : { mode });
      if (!cancelled) {
        await withLockRetry(() => fs.promises.rename(tmp, filePath), () => cancelled);
        return 'written';
      }
    } catch (err) {
      if (!cancelled) {
        await removeTemp();
        throw err;
      }
    }
    // Cancelled: its temp file may have been made after cancel() looked.
    await removeTemp();
    return 'cancelled';
  })();
  return {
    done,
    cancel() {
      cancelled = true;
      try {
        withLockRetrySync(() => fs.unlinkSync(tmp));
        return true;
      } catch (err) {
        // Not there: not written yet (and now never renamed), or renamed
        // already, so before anything the caller writes next.
        if (errorCode(err) === 'ENOENT') return true;
        logger.warn(`[json-file] could not stop a write to ${filePath}:`, err);
        return false;
      }
    },
  };
}
