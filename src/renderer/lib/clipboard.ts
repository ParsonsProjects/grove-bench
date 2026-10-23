/** Copy text for a rendered copy button's data-code attribute, encoded so any
 *  characters survive the HTML attribute and sanitizing. */
export function encodeCopyText(text: string): string {
  return btoa(encodeURIComponent(text));
}

export function decodeCopyText(encoded: string): string {
  return decodeURIComponent(atob(encoded));
}

/**
 * Put `plain` and `html` on the clipboard as one item: rich targets (Excel,
 * Word, Sheets, Outlook) paste the HTML, plain-text targets paste `plain`.
 * Falls back to plain text alone when ClipboardItem is missing or the rich
 * write is refused.
 */
export async function writeRichText(plain: string, html: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch { /* fall through to plain text */ }
  }
  await navigator.clipboard.writeText(plain);
}
