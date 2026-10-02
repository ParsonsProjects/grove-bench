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

/** A rendered table copy button's table: its Markdown source, the same cells
 *  as tab-separated text (for plain-text targets), and its HTML (so
 *  spreadsheets and documents paste real cells). */
export function renderedTable(btn: HTMLElement): { markdown: string; tsv: string; html: string } | null {
  // The renderer puts the table straight beside its button. Raw HTML in a
  // cell can close the wrapper early and leave the button next to another
  // table (a hidden one, say), so look nowhere else, and copy nothing hidden.
  const wrapper = btn.parentElement;
  const table = wrapper?.classList.contains('table-wrapper')
    ? wrapper.querySelector<HTMLTableElement>(':scope > table')
    : null;
  const encoded = btn.dataset.code;
  return table && encoded && isShown(table)
    ? { markdown: decodeCopyText(encoded), tsv: tableToTsv(table), html: shownHtml(table) }
    : null;
}

/** The table's HTML without the parts that aren't displayed, so documents
 *  and spreadsheets paste what the screen shows. */
function shownHtml(table: HTMLTableElement): string {
  const clone = table.cloneNode(true) as HTMLTableElement;
  // Both lists are in document order, so the same index is the same element.
  const copies = clone.querySelectorAll('*');
  table.querySelectorAll('*').forEach((el, i) => {
    if (!isShown(el)) copies[i].remove();
  });
  return clone.outerHTML;
}

/** Whether `el` is displayed. jsdom has no checkVisibility, so there it
 *  counts as shown. */
function isShown(el: Element): boolean {
  return el.checkVisibility?.() ?? true;
}

/** A table's text with a tab between cells and a line per row, which
 *  spreadsheets split into cells when they paste plain text (they keep a
 *  Markdown row in one cell). Rows and cells that aren't displayed are left
 *  out, as they are from the screen. */
export function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .filter(isShown)
    .map((row) => Array.from(row.cells).filter(isShown).map(tsvCell).join('\t'))
    .join('\n');
}

/** A cell's text as displayed, on one line: a tab or line break inside it
 *  would start a new cell or row. */
function tsvCell(cell: HTMLTableCellElement): string {
  // innerText skips hidden content and breaks lines at <br>, list items and
  // paragraphs, where textContent would run the words together. jsdom has no
  // innerText.
  const text = (cell.innerText ?? cell.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Spreadsheet paste can read a cell that starts with a quote as a quoted
  // cell, dropping the quotes, or running an unclosed one on into the next
  // cells. Quoting it keeps the text as shown.
  return text.startsWith('"') ? `"${text.replaceAll('"', '""')}"` : text;
}
