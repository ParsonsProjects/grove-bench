/**
 * URL helpers for the Preview tab, shared by main (navigation rules, agent
 * tools) and renderer (address bar, link routing, dev server detection).
 * Pure string work on the WHATWG URL parser so both processes agree.
 */

/** True for hosts that point at this machine. The wildcard bind addresses
 *  dev servers print (0.0.0.0, ::) count, since they are opened as localhost. */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost'
    || h.endsWith('.localhost')
    || h === '::1'
    || h === '::'
    || h === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** True for http(s) URLs on this machine (localhost, 127.x, [::1]). */
export function isLocalHttpUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && isLocalHostname(u.hostname);
}

/** Rewrite the wildcard bind addresses dev servers print (0.0.0.0, [::]) to
 *  localhost, which a browser can actually open. Other URLs are unchanged. */
export function toBrowsableUrl(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.hostname === '0.0.0.0' || u.hostname === '[::]') {
    u.hostname = 'localhost';
    return u.href;
  }
  return url;
}

const SCHEMES = new Set(['http:', 'https:', 'file:', 'about:']);

/**
 * Turn what someone typed in the address bar into a URL, or null when it
 * can't be one. A bare port opens that port on localhost, local hosts and IPs
 * get http://, other hosts get https://, and a Windows path becomes a file URL.
 */
export function normalizeTypedUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (text === 'about:blank') return text;

  let candidate: string;
  if (/^\d{2,5}$/.test(text)) {
    candidate = `http://localhost:${text}/`;
  } else if (/^:\d{2,5}(?:[/?#].*)?$/.test(text)) {
    candidate = `http://localhost${text}`;
  } else if (/^[a-zA-Z]:[\\/]/.test(text)) {
    candidate = 'file:///' + encodeURI(text.replace(/\\/g, '/'));
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^about:/i.test(text)) {
    candidate = text;
  } else {
    // No scheme. "localhost:3000" also lands here: it looks like scheme
    // "localhost:", so the check above requires "://".
    const host = text.split(/[/?#]/)[0].replace(/:\d+$/, '');
    const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const local = isLocalHostname(host);
    if (!local && !isIp && !host.includes('.')) return null;
    candidate = `${local || isIp ? 'http' : 'https'}://${text}`;
  }

  let u: URL;
  try { u = new URL(candidate); } catch { return null; }
  if (!SCHEMES.has(u.protocol)) return null;
  return toBrowsableUrl(u.href);
}

/** CSI and OSC escape sequences. Dev servers colour parts of their URLs
 *  (Vite bolds the port) and terminals may wrap links in OSC 8. */
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-z0-9-]+\.localhost)(?::\d{1,5})?(?:[/?#][^\s)>\]'"`]*)?/gi;

/**
 * Local http(s) URLs in terminal or tool output, in order of appearance,
 * without duplicates. Wildcard hosts become localhost and trailing
 * punctuation is dropped. A URL without a path is given "/".
 */
export function findLocalUrls(text: string): string[] {
  const clean = text.replace(ANSI_PATTERN, '');
  const found: string[] = [];
  for (const match of clean.matchAll(LOCAL_URL_PATTERN)) {
    const trimmed = match[0].replace(/[.,;:!?]+$/, '');
    let url: string;
    try { url = new URL(toBrowsableUrl(trimmed)).href; } catch { continue; }
    if (!found.includes(url)) found.push(url);
  }
  return found;
}
