/**
 * Files in a thread's worktree that the thread links to: images and links in
 * the agent's replies that name a local file, and the files it made in a turn.
 */
import { messageStore } from '../stores/messages.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';

/** Lines in a file, first to last (both 1-based, the same for one line). */
export interface LineRange {
  start: number;
  end: number;
}

/** A local file a link names, the anchor in it (`#summary`), if any, and
 *  the lines it points at (`:42`, `#L42-L50`), if any. */
export interface LocalFileTarget {
  path: string;
  hash: string;
  lines?: LineRange;
}

/** A line, or a line and column, an agent writes after a path
 *  (`src/app.ts:42`, `app.ts:42:7`). Windows file names can't hold a `:`. */
const LINE_SUFFIX = /:(\d+)(?::\d+)?$/;
/** A file name with no folder and a line, which would otherwise read as a
 *  scheme: `app.ts:42`, but not `tel:123` or `localhost:3000`. A dotted
 *  host and port (`example.com:8080`) reads as one too; without `http://`
 *  it was never a link that worked. The extension is a lookahead for a
 *  letter then one run, so a long name that doesn't match fails in linear
 *  time (`[a-z0-9]*[a-z][a-z0-9]*` backtracked quadratically). */
const NAME_WITH_LINE = /^[^:/\\]+\.(?=[a-z0-9]*[a-z])[a-z0-9]+:\d+(?::\d+)?(?:[?#].*)?$/i;
/** GitHub's and VS Code's anchor for a line or lines: `#L42`, `#L42-L50`,
 *  `#L42-50`, with or without a column (`#L42C7`). */
const LINE_ANCHOR = /^#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i;

/** Lines `a` to `b`, either way round, or undefined for none (line 0). */
function lineRange(a: string, b = a): LineRange | undefined {
  const [start, end] = [Number(a), Number(b)].sort((x, y) => x - y);
  return start > 0 ? { start, end } : undefined;
}

/**
 * The local file a link or image source in a reply names (a path, absolute
 * or relative to the worktree, or a file:// URL), else null for a web address
 * or an in-page link. A `?query` or `#anchor` at the end is split off, but
 * only when no path follows it, so a folder named `C#` stays in the path. A
 * line number after the path (`:42`) is split off too, and it, or a line
 * anchor (`#L42`), gives `lines`. Percent-escapes are decoded after that
 * (marked encodes the links it writes, and `%23` is a `#` in the name); a
 * file:// URL is left encoded for main to read.
 */
export function localFileTarget(href: string | null | undefined): LocalFileTarget | null {
  const h = href?.trim();
  if (!h || h.startsWith('#') || h.startsWith('?') || h.startsWith('//')) return null;
  const isFileUrl = /^file:/i.test(h);
  // A scheme (http:, mailto:, data:), but not a Windows drive letter (C:\).
  if (!isFileUrl && /^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[a-z]:[\\/]/i.test(h) && !NAME_WITH_LINE.test(h)) return null;
  const [, withLine, suffix = ''] = /^(.*?)([?#][^/\\]*)?$/.exec(h)!;
  const line = LINE_SUFFIX.exec(withLine);
  const raw = line ? withLine.slice(0, line.index) : withLine;
  if (!raw) return null;
  const hashAt = suffix.indexOf('#');
  const hash = hashAt >= 0 ? suffix.slice(hashAt) : '';
  const anchor = LINE_ANCHOR.exec(hash);
  const lines = line ? lineRange(line[1]) : anchor ? lineRange(anchor[1], anchor[2]) : undefined;
  if (isFileUrl) return { path: raw, hash, lines };
  try {
    // Component, not URI: decodeURI would leave %23 (#) and %3F (?) encoded.
    return { path: decodeURIComponent(raw), hash, lines };
  } catch {
    return { path: raw, hash, lines };
  }
}

/** The path part of localFileTarget: the file, without query or anchor. */
export function localFilePath(href: string | null | undefined): string | null {
  return localFileTarget(href)?.path ?? null;
}

/** The folder a file is in, for the paths it names (see pathFrom). */
export function folderOf(filePath: string): string {
  const at = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return at < 0 ? '' : filePath.slice(0, at) || filePath.slice(0, 1);
}

/** A path a Markdown file names, read from the file's `folder`, as a link in
 *  it would be: a relative one joined to the folder (`..` and `.` worked
 *  out), an absolute one or a file:// URL as it is. Main still refuses one
 *  that leads out of the worktree. */
export function pathFrom(folder: string, path: string): string {
  if (!folder || /^([\\/]|[a-z]:[\\/]|file:)/i.test(path)) return path;
  const root = /^(?:[a-z]:)?[\\/]*/i.exec(folder)![0];
  const parts: string[] = [];
  for (const part of `${folder.slice(root.length)}/${path}`.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return root.replace(/\\/g, '/') + parts.join('/');
}

/** Open a file in the thread's worktree: a web page in the Preview tab (at
 *  `hash`, an anchor in it), a Markdown file in the Focus panel, another text
 *  file there as numbered lines (scrolled to `lines`, if given), anything
 *  else as main decides (worktree-files.ts). False when it's gone. */
export async function openWorktreeFile(sessionId: string, filePath: string, hash = '', lines?: LineRange): Promise<boolean> {
  const result = await window.groveBench.openWorktreeFile(sessionId, filePath);
  if (result.kind === 'preview') {
    previewStore.setMode(sessionId, 'user');
    messageStore.setActiveTab(sessionId, 'preview');
    await previewStore.navigate(sessionId, 'user', result.url + hash).catch((err) => console.warn(`Could not preview ${filePath}:`, err));
  } else if (result.kind === 'markdown') {
    markdownPreviewStore.show(result.content, filePath, sessionId, folderOf(filePath));
  } else if (result.kind === 'text') {
    markdownPreviewStore.showCode(result.content, filePath, sessionId, lines);
  }
  return result.kind !== 'missing';
}
