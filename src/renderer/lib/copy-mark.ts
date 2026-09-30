import { decodeCopyText } from './clipboard.js';

/** Marks the copy buttons MarkdownBlock renders for code blocks and tables.
 *  Chat content can include raw HTML, and a button it writes must not work
 *  as one: it could show one command and copy another. Random per launch,
 *  so content can't guess it. */
export const COPY_MARK = crypto.randomUUID();

/** Whether `el` is a copy button MarkdownBlock rendered, not one in chat HTML. */
export function isRenderedCopyButton(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.dataset.copy === COPY_MARK;
}

/** The code a rendered code block's copy button copies: the text the block
 *  shows. The renderer escaped it, so it holds no markup that could hide part
 *  of it. */
export function renderedCode(btn: HTMLElement): string | null {
  const code = btn.closest('.code-block-wrapper')?.querySelector('pre > code');
  return code ? (code.textContent ?? '') : null;
}

/** A rendered table copy button's table: its Markdown source (for plain-text
 *  targets) and its HTML (so spreadsheets and documents paste real cells). */
export function renderedTable(btn: HTMLElement): { markdown: string; html: string } | null {
  const table = btn.parentElement?.querySelector('table');
  const encoded = btn.dataset.code;
  return table && encoded ? { markdown: decodeCopyText(encoded), html: table.outerHTML } : null;
}
