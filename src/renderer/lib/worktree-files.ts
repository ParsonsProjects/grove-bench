/**
 * Files in a thread's worktree that the thread links to: images and links in
 * the agent's replies that name a local file, and the files it made in a turn.
 */
import { messageStore } from '../stores/messages.svelte.js';
import { previewStore } from '../stores/preview.svelte.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { textFileMarkdown } from './thread-files.js';

/** A local file a link names, and the anchor in it (`#summary`), if any. */
export interface LocalFileTarget {
  path: string;
  hash: string;
}

/** A line, or a line and column, an agent writes after a path
 *  (`src/app.ts:42`, `app.ts:42:7`). Windows file names can't hold a `:`. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
/** A file name with no folder and a line, which would otherwise read as a
 *  scheme: `app.ts:42`, but not `tel:123` or `localhost:3000`. */
const NAME_WITH_LINE = /^[^:/\\]+\.[a-z0-9]*[a-z][a-z0-9]*:\d+(?::\d+)?(?:[?#].*)?$/i;

/**
 * The local file a link or image source in a reply names (a path, absolute
 * or relative to the worktree, or a file:// URL), else null for a web address
 * or an in-page link. A `?query` or `#anchor` at the end is split off, but
 * only when no path follows it, so a folder named `C#` stays in the path. A
 * line number after the path (`:42`) is dropped. Percent-escapes are decoded after that
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
  const raw = withLine.replace(LINE_SUFFIX, '');
  if (!raw) return null;
  const hashAt = suffix.indexOf('#');
  const hash = hashAt >= 0 ? suffix.slice(hashAt) : '';
  if (isFileUrl) return { path: raw, hash };
  try {
    // Component, not URI: decodeURI would leave %23 (#) and %3F (?) encoded.
    return { path: decodeURIComponent(raw), hash };
  } catch {
    return { path: raw, hash };
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
 *  file there as a code block, anything else as main decides
 *  (worktree-files.ts). False when it's gone. */
export async function openWorktreeFile(sessionId: string, filePath: string, hash = ''): Promise<boolean> {
  const result = await window.groveBench.openWorktreeFile(sessionId, filePath);
  if (result.kind === 'preview') {
    previewStore.setMode(sessionId, 'user');
    messageStore.setActiveTab(sessionId, 'preview');
    await previewStore.navigate(sessionId, 'user', result.url + hash).catch((err) => console.warn(`Could not preview ${filePath}:`, err));
  } else if (result.kind === 'markdown') {
    markdownPreviewStore.show(result.content, filePath, sessionId, folderOf(filePath));
  } else if (result.kind === 'text') {
    markdownPreviewStore.show(textFileMarkdown(filePath, result.content), filePath, sessionId, folderOf(filePath));
  }
  return result.kind !== 'missing';
}
