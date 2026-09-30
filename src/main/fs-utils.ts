import fs from 'node:fs/promises';
import { execa } from 'execa';

/**
 * Recursively delete a directory.
 *
 * On Windows, large trees (worktrees with node_modules) are handed to
 * `rmdir /s /q` in a child process so the deletion does not tie up the main
 * process's libuv thread pool, which every other fs call in the app shares.
 * If the directory still exists afterwards (locked handles, permissions), fall
 * back to `fs.rm`, which surfaces a proper error (EBUSY, EPERM, …) for callers
 * that retry.
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execa('cmd.exe', ['/d', '/s', '/c', `rmdir /s /q "${dirPath}"`], {
        windowsHide: true,
        reject: false,
        timeout: 5 * 60_000,
      });
    } catch { /* fall through to fs.rm */ }
    if (!(await pathExists(dirPath))) return;
  }
  await fs.rm(dirPath, { recursive: true, force: true });
}

/** Default backoff schedule (ms) for retrying a locked directory on Windows. */
export const DEFAULT_REMOVE_DELAYS_MS = [200, 500, 1000];

/**
 * Delete a directory, retrying with backoff when Windows reports it busy.
 * Throws the last error when every attempt fails so the caller can defer the
 * cleanup rather than silently abandon the directory.
 */
export async function removeDirectoryWithRetry(
  dirPath: string,
  delaysMs: number[] = DEFAULT_REMOVE_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      await removeDirectory(dirPath);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < delaysMs.length) await sleep(delaysMs[attempt]);
    }
  }
  throw lastErr;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Errors Windows raises while another process (antivirus, the indexer, a
 *  backup tool) briefly holds a file. */
const TRANSIENT_FS_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** Retry `op` a few times while it fails with a transient lock error. */
async function withLockRetry<T>(
  op: () => Promise<T>,
  delaysMs: number[] = [50, 150, 400],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= delaysMs.length || !code || !TRANSIENT_FS_CODES.has(code)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}

/** Read a file, riding out brief locks. Other errors (ENOENT included) throw. */
export function readFileWithRetry(filePath: string, sleep?: (ms: number) => Promise<void>): Promise<string> {
  return withLockRetry(() => fs.readFile(filePath, 'utf-8'), undefined, sleep);
}

/**
 * Replace a file's contents all at once: write a temp file beside it, then
 * rename it over the original. A crash mid-write leaves the old file intact
 * instead of a truncated one, and readers never see a half-written file.
 */
export async function writeFileAtomic(filePath: string, data: string, sleep?: (ms: number) => Promise<void>): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await withLockRetry(() => fs.rename(tmp, filePath), undefined, sleep);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
