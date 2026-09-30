/**
 * Synchronous JSON files under userData (settings, app state, credentials).
 *
 * Reads tell a missing file from a damaged one and from one that can't be
 * read right now, so callers never mistake a passing lock for "nothing
 * saved" and write defaults over the real file. Writes replace the file all
 * at once, so a crash mid-write can't leave it truncated.
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
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt >= LOCK_RETRY_DELAYS_MS.length || !code || !LOCK_CODES.has(code)) throw err;
      sleepSync(LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function readJsonFile(filePath: string): JsonFileRead {
  let text: string;
  try {
    text = withLockRetrySync(() => fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'missing' };
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

/** Write a temp file beside `filePath`, then rename it over the original. */
export function writeFileAtomicSync(filePath: string, data: string, mode?: number): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
  try {
    withLockRetrySync(() => fs.renameSync(tmp, filePath));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}
