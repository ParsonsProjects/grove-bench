/**
 * Converts localhost/127.0.0.1 URLs in plain text to clickable <a> tags.
 * Used for tool output (Bash, etc.) where text isn't markdown-parsed.
 */

const LOCALHOST_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):\d+[^\s)>\]'"]*/g;

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Replace localhost URLs with <a> tags that open externally. `text` is
 *  already HTML-escaped (callers escape it first), so a URL is unescaped
 *  before it becomes an attribute: escaping it again would turn a query's
 *  `&` into a literal `&amp;` in the link. */
export function linkifyLocalhost(text: string): string {
  return text.replace(LOCALHOST_PATTERN, (url) => {
    // Normalize 0.0.0.0 and [::] to localhost for the href
    const normalized = url.replace(/0\.0\.0\.0|\[::\]/, 'localhost')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const safeHref = escapeAttr(normalized);
    return `<a href="${safeHref}" class="localhost-link" data-url="${safeHref}">${url}</a>`;
  });
}

/** Check if a string contains any localhost URLs. */
export function hasLocalhostUrl(text: string): boolean {
  // Use a fresh regex to avoid global lastIndex issues
  return /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):\d+/.test(text);
}
