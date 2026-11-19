import fs from 'node:fs/promises';

/** Names Windows keeps for devices, with any extension too (AUX.ts is AUX). */
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * `name` as a file name Windows takes: the characters it doesn't allow in a
 * name (path separators among them) become spaces, runs of spaces one, at
 * most `max` characters,
 * and no dots or spaces at the end. A device name (CON, or CON.txt) gets
 * `devicePrefix` in front. '' when nothing is left.
 */
export function safeFileName(name: string, max: number, devicePrefix: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '');
  // Windows reads the name before the extension without its trailing spaces.
  const stem = safe.split('.')[0].trimEnd();
  return safe && DEVICE_NAME.test(stem) ? `${devicePrefix}${safe}` : safe;
}

/**
 * Recursively delete a directory, with `fs.rm`. One that isn't there counts
 * as deleted. Errors (EBUSY, EPERM, … while another process holds a file)
 * are thrown for callers that retry (removeDirectoryWithRetry).
 *
 * No `rmdir /s /q` in a cmd.exe first, as there once was: Node quoted its
 * path with backslash escapes cmd.exe doesn't read, so it most likely never
 * deleted anything, and it cost a process launch on every delete.
 */
export async function removeDirectory(dirPath: string): Promise<void> {
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
export async function withLockRetry<T>(
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
