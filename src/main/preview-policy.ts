/**
 * Which top-level URLs each Preview page may load.
 *
 * - Your page (the one you drive in the Preview tab): any http(s) site.
 * - Claude's page (driven by the agent's browser tools): local http(s) only
 *   (localhost, 127.x, [::1]), so a prompt-injected page can't send the agent
 *   off to another site.
 * - Both: about:blank, and file:// URLs inside the conversation's worktree.
 *   Claude's page only opens .html/.htm files, so preview_read can't be used
 *   to read files (like .env) that the user's read rules keep from the agent.
 *
 * Only top-level navigations are checked. A local app can still load scripts,
 * fonts and API calls from anywhere, like it would in a normal browser.
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
      reason: `Claude's browser only opens local pages (localhost, 127.0.0.1, [::1]) or .html files in this conversation's worktree, not ${u.host}.`,
    };
  }

  if (u.protocol === 'file:') {
    let filePath: string;
    try { filePath = fileURLToPath(u); } catch { return { ok: false, reason: `Not a valid file URL: ${url}` }; }
    if (!worktreePath || !isPathInside(path.resolve(worktreePath), path.resolve(filePath))) {
      return { ok: false, reason: `Only files inside this conversation's worktree can be opened (${worktreePath}).` };
    }
    if (audience === 'agent' && !/\.html?$/i.test(filePath)) {
      return { ok: false, reason: "Claude's browser only opens .html files from the worktree. Use the Read tool for other files." };
    }
    return { ok: true };
  }

  return { ok: false, reason: `${u.protocol.replace(/:$/, '')}: links can't be opened in the preview.` };
}
