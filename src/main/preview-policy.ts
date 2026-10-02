/**
 * Which top-level URLs each Preview page may load.
 *
 * - Your page (the one you drive in the Preview tab): any http(s) site.
 * - The agent's page (driven by its browser tools): local http(s) only
 *   (localhost, 127.x, [::1]), so a prompt-injected page can't send the agent
 *   off to another site.
 * - Both: about:blank, and file:// URLs inside the conversation's worktree.
 *   The agent's page only opens .html/.htm files, so preview_read can't be used
 *   to read files (like .env) that the user's read rules keep from the agent.
 *
 * checkNavigation covers top-level navigations. A local app can still load
 * scripts, fonts and API calls from anywhere, like a normal browser. File
 * loads are the exception (checkFileRequest): a page, frame, image or script
 * from file:// must come from inside the worktree, and the agent's page only
 * loads web file types, so an iframe or script tag can't show it a .env or a
 * key file either.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalHttpUrl } from '../shared/preview-url.js';
import { isPathInside } from './agent-utils.js';

export type PreviewAudience = 'user' | 'agent';

export type NavigationCheck = { ok: true } | { ok: false; reason: string };

export function checkNavigation(url: string, audience: PreviewAudience, worktreePath: string): NavigationCheck {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: `Not a valid URL: ${url}` }; }

  if (u.href === 'about:blank') return { ok: true };

  if (u.protocol === 'http:' || u.protocol === 'https:') {
    if (audience === 'user' || isLocalHttpUrl(u.href)) return { ok: true };
    return {
      ok: false,
      reason: `The agent's browser only opens local pages (localhost, 127.0.0.1, [::1]) or .html files in this conversation's worktree, not ${u.host}.`,
    };
  }

  if (u.protocol === 'file:') {
    const filePath = worktreeFile(u, worktreePath);
    if (!filePath) {
      return { ok: false, reason: `Only files inside this conversation's worktree can be opened (${worktreePath}).` };
    }
    if (audience === 'agent' && !/\.html?$/i.test(filePath)) {
      return { ok: false, reason: "The agent's browser only opens .html files from the worktree. Use the Read tool for other files." };
    }
    return { ok: true };
  }

  return { ok: false, reason: `${u.protocol.replace(/:$/, '')}: links can't be opened in the preview.` };
}

/** The file a file:// URL points to, if it's inside the worktree. */
function worktreeFile(u: URL, worktreePath: string): string | null {
  let filePath: string;
  try { filePath = fileURLToPath(u); } catch { return null; }
  if (!worktreePath || !isPathInside(path.resolve(worktreePath), path.resolve(filePath))) return null;
  return filePath;
}

/** File types a static page needs: markup, styles, scripts, images, fonts, media. */
const WEB_FILE = /\.(?:html?|css|m?js|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav)$/i;

/**
 * Whether a file:// request (page, frame, image, script, fetch...) may load.
 * Both pages: only files inside the worktree. The agent's page: only web file
 * types too. Non-file URLs are not this check's business and pass.
 */
export function checkFileRequest(url: string, audience: PreviewAudience, worktreePath: string): NavigationCheck {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, reason: `Not a valid URL: ${url}` }; }
  if (u.protocol !== 'file:') return { ok: true };
  const filePath = worktreeFile(u, worktreePath);
  if (!filePath) return { ok: false, reason: `Blocked a file outside this conversation's worktree: ${url}` };
  if (audience === 'agent' && !WEB_FILE.test(filePath)) {
    return { ok: false, reason: `Blocked a non-web file in the agent's browser: ${url}` };
  }
  return { ok: true };
}
