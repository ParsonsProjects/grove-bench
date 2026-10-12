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
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MadeFileKind } from '../shared/types.js';
import { madeFileKind } from '../shared/attachments.js';
import { logger } from './logger.js';

/** Folders of dependencies, caches and compiled output, skipped wherever they
 *  are. `out` and `build` are not: scripts save reports and screenshots there
 *  as often as builds write to them. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.cache', '.parcel-cache', '.vite', '.gradle', 'dist', 'target', 'bin', 'obj', 'coverage',
]);

/** How many changed paths a turn notes. A turn that churns more than this
 *  stops noting new ones; the list is a convenience, not a record. */
const MAX_CANDIDATES = 2000;
/** How many files a turn lists; the rest are counted. */
export const MAX_LISTED = 24;
/** File times can trail the clock: FAT keeps them to 2 seconds. */
const CLOCK_SLACK_MS = 2000;

export type WatchFn = (root: string, onChange: (relPath: string) => void, onError: (err: unknown) => void) => { close(): void };
type StatFn = (p: string) => Promise<Pick<fs.Stats, 'isFile' | 'size' | 'mtimeMs' | 'birthtimeMs'>>;

/** fs.watch over the whole tree: native and cheap on Windows (and macOS). */
const watchTree: WatchFn = (root, onChange, onError) => {
  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    if (filename) onChange(filename.toString());
  });
  watcher.on('error', onError);
  return watcher;
};

export interface FoundFile {
  /** Relative to the worktree, with forward slashes. */
  path: string;
  /** Absolute, to read it from. */
  absPath: string;
  kind: MadeFileKind;
  size: number;
}

/** Whether a changed path is one a turn's list could hold: a kind it shows,
 *  outside the skipped folders. */
export function isListable(relPath: string): boolean {
  if (!madeFileKind(relPath)) return false;
  const dirs = relPath.split(/[\\/]/).slice(0, -1);
  return !dirs.some((d) => SKIPPED_DIRS.has(d.toLowerCase()));
}

export class TurnFiles {
  private readonly candidates = new Set<string>();
  /** Files the agent edited in place, keyed by caseKey. */
  private readonly edited = new Set<string>();
  private watcher: { close(): void } | null = null;
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
      this.watcher = (opts.watch ?? watchTree)(root, (rel) => this.note(rel), (err) => {
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
    this.watcher?.close();
    this.watcher = null;
  }

  /**
   * Stop watching, and return the files the turn made: still there, not
   * empty, and written since it began (watchers also report files only
   * read). A web page counts only when it is new this turn and wasn't
   * edited in place, so editing a site's pages doesn't list them. Images
   * come first, then by path; past MAX_LISTED they're counted in `more`.
   */
  async finish(): Promise<{ files: FoundFile[]; more: number }> {
    this.close();
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
