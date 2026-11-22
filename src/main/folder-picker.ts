import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** How long to wait to learn whether the last project's folder is there. A
 *  folder on an offline network share or a disconnected mapped drive takes
 *  until Windows' SMB timeout (tens of seconds) to fail, and the picker
 *  mustn't wait that long to open. */
export const FOLDER_CHECK_MS = 300;

/** Checks still running, by folder. Clicking again joins the running one
 *  instead of starting another: a stat stuck on a network share holds one of
 *  libuv's threads (4 by default) until it fails. */
const running = new Map<string, Promise<boolean>>();

function isFolder(dir: string, stat: typeof fs.stat): Promise<boolean> {
  let check = running.get(dir);
  if (!check) {
    check = stat(dir)
      .then((s) => s.isDirectory(), () => false)
      .finally(() => running.delete(dir));
    running.set(dir, check);
  }
  return check;
}

/**
 * Where "Select a project folder" opens: the folder holding `lastProject`,
 * else `home`. Since Electron 43 the picker opens in Downloads when it's
 * given no defaultPath, and Windows no longer reopens the last folder used.
 * A folder that is gone, or doesn't answer within `timeoutMs`, gives `home`.
 */
export async function projectPickerStart(
  lastProject: string | null,
  home: string,
  opts: { timeoutMs?: number; stat?: typeof fs.stat } = {},
): Promise<string> {
  if (!lastProject) return home;
  const parent = path.dirname(lastProject);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<false>((resolve) => { timer = setTimeout(resolve, opts.timeoutMs ?? FOLDER_CHECK_MS, false); });
  try {
    return (await Promise.race([isFolder(parent, opts.stat ?? fs.stat), slow])) ? parent : home;
  } finally {
    clearTimeout(timer);
  }
}
