import { describe, it, expect, afterEach } from 'vitest';
import { selectionLinks } from './selection-links.js';

let root: HTMLDivElement;

function mount(html: string): HTMLDivElement {
  root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => root?.remove());

/** The links in a range, read with the range's own text as the selection's. */
function linksOf(range: Range) {
  return selectionLinks(range, range.toString().trim());
}

function rangeOver(node: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

describe('selectionLinks', () => {
  it('keeps web and worktree file links, with their text, first to last', () => {
    const el = mount(
      '<p>See the <a href="https://docs.example.dev/setup">setup guide</a> and '
      + '<a href="#" data-local-href="docs/plan.md#L3">the plan</a>.</p>',
    );
    expect(linksOf(rangeOver(el))).toEqual([
      { kind: 'web', href: 'https://docs.example.dev/setup', text: 'setup guide' },
      { kind: 'file', href: 'docs/plan.md#L3', text: 'the plan' },
    ]);
  });

  it('leaves out links a bookmark can not follow', () => {
    const el = mount('<a href="mailto:a@b.dev">mail</a> <a href="#intro">intro</a> <a href="?x=1">query</a>');
    expect(linksOf(rangeOver(el))).toEqual([]);
  });

  it('keeps a link the selection is all inside, by its whole text', () => {
    const el = mount('<p>Read <a href="https://example.com/a">the long article</a> later</p>');
    const text = el.querySelector('a')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 8);
    expect(linksOf(range)).toEqual([{ kind: 'web', href: 'https://example.com/a', text: 'the long article' }]);
  });

  it('keeps a link the selection cuts into', () => {
    const el = mount('<p>Start here <a href="https://example.com/b">then this</a></p>');
    const [before] = el.querySelector('p')!.childNodes;
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(el.querySelector('a')!.firstChild!, 4);
    expect(linksOf(range).map((l) => l.href)).toEqual(['https://example.com/b']);
  });

  it('leaves out a link the selection only touches', () => {
    const el = mount('<p>Plain text</p><p><a href="https://example.com/c">next</a></p>');
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 0);
    range.setEnd(el.querySelector('a')!.firstChild!, 0);
    expect(linksOf(range)).toEqual([]);
  });

  it('keeps addresses written as plain text, without the punctuation after them', () => {
    const el = mount('<pre>Docs at https://example.com/docs. Also https://en.wikipedia.org/wiki/Foo_(bar), '
      + '(see https://example.com/x) and http://localhost:5173/!</pre>');
    expect(linksOf(rangeOver(el)).map((l) => l.href)).toEqual([
      'https://example.com/docs',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://example.com/x',
      'http://localhost:5173/',
    ]);
  });

  it('reads an address the selection cuts off at its end to its end', () => {
    const el = mount('<pre>open https://example.com/path/to/page now</pre>');
    const text = el.querySelector('pre')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 'open https://exa'.length);
    expect(linksOf(range)).toEqual([
      { kind: 'web', href: 'https://example.com/path/to/page', text: 'https://example.com/path/to/page' },
    ]);
  });

  it("doesn't read past an address that ends where the selection does", () => {
    const el = mount('<pre>open https://example.com/a next</pre>');
    const text = el.querySelector('pre')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 'open https://example.com/a '.length);
    expect(linksOf(range).map((l) => l.href)).toEqual(['https://example.com/a']);
  });

  it("doesn't keep a link's address twice", () => {
    const el = mount(
      '<p><a href="https://example.com/%C3%A4">https://example.com/ä</a> and '
      + '<a href="https://example.com/%C3%A4">again</a></p>',
    );
    expect(linksOf(rangeOver(el))).toEqual([
      { kind: 'web', href: 'https://example.com/%C3%A4', text: 'https://example.com/ä' },
    ]);
  });

  it("doesn't keep part of a link's address as a bare one", () => {
    const el = mount('<p>Go to <a href="https://example.com/long/path">https://example.com/long/path</a></p>');
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 0);
    range.setEnd(el.querySelector('a')!.firstChild!, 'https://example.com/lo'.length);
    // The selection's text ends mid-address, inside the link.
    expect(selectionLinks(range, 'Go to https://example.com/lo')).toEqual([
      { kind: 'web', href: 'https://example.com/long/path', text: 'https://example.com/long/path' },
    ]);
  });

  it('keeps nothing from a bare scheme', () => {
    const el = mount('<pre>the https:// prefix</pre>');
    expect(linksOf(rangeOver(el))).toEqual([]);
  });
});
