/**
 * Files in a conversation's worktree that its thread shows or opens: images
 * the agent linked in a reply or wrote (loaded over
 * grove-attachment://worktree/...), and files it made in a turn, opened from
 * the thread. Paths come from the agent, so each one must resolve, symlinks
 * followed, to a file inside the worktree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shell } from 'electron';
import type { OpenWorktreeFileResult } from '../shared/types.js';
import { isMarkdownFile, madeFileKind, worktreeImageType } from '../shared/attachments.js';
import { isPathInside } from './agent-utils.js';

/** Larger images aren't served: a thumbnail doesn't need them. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
/** A Markdown file larger than this is shown in its folder instead: the
 *  Focus panel would be slow to draw it. */
const MAX_MARKDOWN_BYTES = 1024 * 1024;

/** A path as an agent writes it, as a path this OS can resolve: a file://
 *  URL, or on Windows a Git Bash drive path (`/c/Users/...`). */
export function normalizeAgentPath(filePath: string, platform: NodeJS.Platform): string | null {
  let p = filePath.trim();
  if (!p) return null;
  if (/^file:/i.test(p)) {
    try {
      p = fileURLToPath(p);
    } catch {
      return null;
    }
  }
  if (platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) p = `${p[1]}:${p.slice(2)}`;
  return p;
}

/**
 * The real path of `filePath` (relative to the worktree, or absolute) when
 * it is an existing file or folder inside the worktree, following symlinks
 * and junctions, else null.
 */
export async function resolveWorktreeFile(
  worktreePath: string,
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (!worktreePath) return null;
  const p = normalizeAgentPath(filePath, platform);
  if (!p) return null;
  const root = path.resolve(worktreePath);
  const resolved = path.resolve(root, p);
  if (!isPathInside(root, resolved)) return null;
  try {
    const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(resolved)]);
    return isPathInside(realRoot, realFile) ? realFile : null;
  } catch {
    return null;
  }
}

/** The response for a grove-attachment://worktree/<id>/<path> request: the
 *  image at `filePath` in the worktree, if it is one. */
export async function worktreeImageResponse(worktreePath: string, filePath: string): Promise<Response> {
  const mediaType = worktreeImageType(filePath);
  const real = mediaType ? await resolveWorktreeFile(worktreePath, filePath) : null;
  // The real path's type too: a link named .png can't serve a .env.
  if (!real || worktreeImageType(real) !== mediaType) return new Response(null, { status: 404 });
  try {
    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) return new Response(null, { status: 404 });
    if (stat.size > MAX_IMAGE_BYTES) return new Response(null, { status: 413 });
    const data = await fs.promises.readFile(real);
    return new Response(data, {
      headers: {
        'Content-Type': mediaType,
        // The agent may write it again: always check.
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        // Only matters if an SVG were ever opened as a page, not an <img>.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** Kinds a click opens in their default app: viewers, not code. Web pages go
 *  to the Preview tab, and SVGs (which a browser would run) only show in
 *  their folder, like any other type. */
const OPENS_IN_APP: ReadonlySet<string> = new Set(['pdf', 'video', 'audio', 'data', 'document']);

/**
 * Open a file in the worktree from the thread: a web page in the Preview tab
 * (the renderer navigates to the URL returned), a Markdown file in the Focus
 * panel (its text is returned), a viewer's type (PDF, media,
 * spreadsheets, Office documents, raster images) in its default app, a
 * folder in Explorer, and anything else only shown in its folder, so a click
 * never runs a script.
 */
export async function openWorktreeFile(worktreePath: string, filePath: string): Promise<OpenWorktreeFileResult> {
  const real = await resolveWorktreeFile(worktreePath, filePath);
  if (!real) return { kind: 'missing' };
  try {
    const stat = await fs.promises.stat(real);
    if (stat.isDirectory()) {
      return (await shell.openPath(real)) === '' ? { kind: 'opened' } : { kind: 'missing' };
    }
    const kind = madeFileKind(real);
    if (kind === 'html') return { kind: 'preview', url: pathToFileURL(real).href };
    if (isMarkdownFile(real) && stat.size <= MAX_MARKDOWN_BYTES) {
      return { kind: 'markdown', content: await fs.promises.readFile(real, 'utf8') };
    }
    const raster = kind === 'image' && worktreeImageType(real) !== 'image/svg+xml';
    if ((raster || (kind && OPENS_IN_APP.has(kind))) && (await shell.openPath(real)) === '') return { kind: 'opened' };
    shell.showItemInFolder(real);
    return { kind: 'shown' };
  } catch {
    return { kind: 'missing' };
  }
}
