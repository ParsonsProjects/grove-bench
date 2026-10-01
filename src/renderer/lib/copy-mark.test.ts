import { describe, it, expect } from 'vitest';
import { tableToTsv } from './copy-mark.js';

function table(html: string): HTMLTableElement {
  const div = document.createElement('div');
  div.innerHTML = `<table>${html}</table>`;
  return div.querySelector('table')!;
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

  it('keeps a cell on one line so it cannot split into extra cells or rows', () => {
    const t = table('<tr><td>one<br>two</td><td>a\tb\n  c</td></tr>');
    expect(tableToTsv(t)).toBe('one two\ta b c');
  });

  it('keeps empty cells so the columns stay lined up', () => {
    const t = table('<tr><td>a</td><td></td><td>c</td></tr>');
    expect(tableToTsv(t)).toBe('a\t\tc');
  });
});
