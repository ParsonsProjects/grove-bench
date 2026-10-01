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
  const table = btn.parentElement?.querySelector('table');
  const encoded = btn.dataset.code;
  return table && encoded
    ? { markdown: decodeCopyText(encoded), tsv: tableToTsv(table), html: table.outerHTML }
    : null;
}

/** A table's text with a tab between cells and a line per row, which
 *  spreadsheets split into cells when they paste plain text (they keep a
 *  Markdown row in one cell). */
export function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.rows, (row) => Array.from(row.cells, tsvCell).join('\t')).join('\n');
}

/** A cell's text on one line: a tab or line break inside it would start a
 *  new cell or row. */
function tsvCell(cell: HTMLTableCellElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  for (const br of clone.querySelectorAll('br')) br.replaceWith(' ');
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
