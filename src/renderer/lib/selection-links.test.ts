import { describe, it, expect, afterEach } from 'vitest';
import { htmlWithLinks, markdownWithLinks, selectionLinks } from './selection-links.js';

let root: HTMLDivElement;

function mount(html: string): HTMLDivElement {
  root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => root?.remove());

function rangeOver(node: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

const hrefs = (range: Range) => selectionLinks(range).map((l) => l.href);

describe('selectionLinks', () => {
  it('keeps web and worktree file links, with their text, first to last', () => {
    const el = mount(
      '<p>See the <a href="https://docs.example.dev/setup">setup guide</a> and '
      + '<a href="#" data-local-href="docs/plan.md#L3">the plan</a>.</p>',
    );
    expect(selectionLinks(rangeOver(el))).toEqual([
      { kind: 'web', href: 'https://docs.example.dev/setup', text: 'setup guide', shown: 'setup guide' },
      { kind: 'file', href: 'docs/plan.md#L3', text: 'the plan', shown: 'the plan' },
    ]);
  });

  it('leaves out links a bookmark can not follow', () => {
    const el = mount('<a href="mailto:a@b.dev">mail</a> <a href="#intro">intro</a> <a href="?x=1">query</a>');
    expect(selectionLinks(rangeOver(el))).toEqual([]);
  });

  it('keeps a link the selection is all inside, by its whole text', () => {
    const el = mount('<p>Read <a href="https://example.com/a">the long article</a> later</p>');
    const text = el.querySelector('a')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 8);
    expect(selectionLinks(range)).toEqual([
      { kind: 'web', href: 'https://example.com/a', text: 'the long article', shown: 'long' },
    ]);
  });

  it('keeps a link the selection cuts into', () => {
    const el = mount('<p>Start here <a href="https://example.com/b">then this</a></p>');
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 0);
    range.setEnd(el.querySelector('a')!.firstChild!, 4);
    expect(selectionLinks(range)).toEqual([
      { kind: 'web', href: 'https://example.com/b', text: 'then this', shown: 'then' },
    ]);
  });

  it('leaves out a link the selection only touches', () => {
    const el = mount('<p>Plain text</p><p><a href="https://example.com/c">next</a></p>');
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 0);
    range.setEnd(el.querySelector('a')!.firstChild!, 0);
    expect(selectionLinks(range)).toEqual([]);
  });

  it('keeps each link once, however many of its words it takes', () => {
    const el = mount('<p><a href="https://example.com/d">some <code>code</code> here</a></p>');
    expect(selectionLinks(rangeOver(el))).toEqual([
      { kind: 'web', href: 'https://example.com/d', text: 'some code here', shown: 'some code here' },
    ]);
  });

  it('keeps two links to one address, for each to be written in where it is', () => {
    const el = mount('<p><a href="https://example.com/e">one</a> and <a href="https://example.com/e">two</a></p>');
    expect(selectionLinks(rangeOver(el)).map((l) => l.shown)).toEqual(['one', 'two']);
  });

  it('keeps a link that is only an image, by its alt text', () => {
    const el = mount('<p><a href="https://ci.example.dev/run"><img src="badge.svg" alt="build passing"></a> and text</p>');
    expect(selectionLinks(rangeOver(el))).toEqual([
      { kind: 'web', href: 'https://ci.example.dev/run', text: 'build passing', shown: '' },
    ]);
  });

  it("leaves out links that aren't drawn: in a closed <details>, or hidden", () => {
    const el = mount(
      '<p>x</p><details><summary>More <a href="https://example.com/summary">here</a></summary>'
      + '<a href="https://example.com/inside">inside</a> https://example.com/bare</details>'
      + '<p hidden><a href="https://example.com/hidden">hidden</a></p>'
      + '<details open><summary>Open</summary><a href="https://example.com/open">open</a></details>',
    );
    expect(hrefs(rangeOver(el))).toEqual(['https://example.com/summary', 'https://example.com/open']);
  });

  describe('addresses written as text', () => {
    it('keeps them, without the punctuation that ends a sentence', () => {
      const el = mount('<pre>Docs at https://example.com/docs. Also https://en.wikipedia.org/wiki/Foo_(bar), '
        + '(see https://example.com/x) and http://localhost:5173/!</pre>');
      expect(hrefs(rangeOver(el))).toEqual([
        'https://example.com/docs',
        'https://en.wikipedia.org/wiki/Foo_(bar)',
        'https://example.com/x',
        'http://localhost:5173/',
      ]);
    });

    it('leaves off emphasis marks after them, as GFM does', () => {
      const el = mount('<pre>**See https://example.com/docs** and _https://example.com/b_ or ~https://example.com/c~</pre>');
      expect(hrefs(rangeOver(el))).toEqual(['https://example.com/docs', 'https://example.com/b', 'https://example.com/c']);
    });

    it('reads Markdown links written as text as the separate links they are', () => {
      const el = mount('<pre>[![CI](https://x.dev/badge.svg)](https://x.dev/actions) [a](https://a.dev)[b](https://b.dev)</pre>');
      expect(hrefs(rangeOver(el))).toEqual([
        'https://x.dev/badge.svg',
        'https://x.dev/actions',
        'https://a.dev',
        'https://b.dev',
      ]);
    });

    it('keeps an address in the query as part of the one around it', () => {
      const el = mount('<pre>https://example.com/login?next=https://example.com/home</pre>');
      expect(hrefs(rangeOver(el))).toEqual(['https://example.com/login?next=https://example.com/home']);
    });

    it("keeps one that is part of a link's address too", () => {
      const el = mount('<p><a href="https://github.com/o/r/pull/12">the PR</a></p><pre>https://github.com/o/r</pre>');
      expect(hrefs(rangeOver(el))).toEqual(['https://github.com/o/r/pull/12', 'https://github.com/o/r']);
    });

    it("doesn't keep a link's own text as an address", () => {
      const el = mount('<p>Go to <a href="https://example.com/%C3%A4">https://example.com/ä</a></p>');
      expect(hrefs(rangeOver(el))).toEqual(['https://example.com/%C3%A4']);
    });

    it("doesn't run an address into the text after a link", () => {
      const el = mount('<p>at https://a.dev/<a href="https://b.dev">x</a>y</p>');
      expect(hrefs(rangeOver(el))).toEqual(['https://b.dev', 'https://a.dev/']);
    });

    it("doesn't run an address across lines", () => {
      const el = mount('<div>https://example.com/a<br>next</div><p>https://example.com/b</p><p>after</p>');
      expect(hrefs(rangeOver(el))).toEqual(['https://example.com/a', 'https://example.com/b']);
    });

    it('reads one the selection cuts off at its end to its end', () => {
      const el = mount('<pre>open https://example.com/path/to/page now</pre>');
      const text = el.querySelector('pre')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 'open https://exa'.length);
      expect(selectionLinks(range)).toEqual([
        { kind: 'web', href: 'https://example.com/path/to/page', text: 'https://example.com/path/to/page', shown: 'https://example.com/path/to/page' },
      ]);
    });

    it('reads on across the spans a highlighted one is split into', () => {
      const el = mount('<pre><code><span>"https://exa</span><span>mple.com/a</span><span>/b"</span> x</code></pre>');
      const range = document.createRange();
      range.setStart(el.querySelector('code')!, 0);
      range.setEnd(el.querySelector('span')!.firstChild!, '"https://exa'.length);
      expect(hrefs(range)).toEqual(['https://example.com/a/b']);
    });

    it("doesn't read on past one that ends where the selection does", () => {
      const el = mount('<pre>open https://example.com/a next</pre>');
      const text = el.querySelector('pre')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 'open https://example.com/a '.length);
      expect(hrefs(range)).toEqual(['https://example.com/a']);
    });

    it("doesn't read on a word that isn't an address", () => {
      const el = mount('<pre>see http and more</pre>');
      const text = el.querySelector('pre')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 'see htt'.length);
      expect(hrefs(range)).toEqual([]);
    });

    it('keeps nothing from a bare scheme', () => {
      const el = mount('<pre>the https:// prefix</pre>');
      expect(hrefs(rangeOver(el))).toEqual([]);
    });
  });
});

describe('markdownWithLinks', () => {
  const web = { kind: 'web' as const, href: 'https://docs.example.dev/setup', text: 'setup guide' };
  const file = { kind: 'file' as const, href: 'docs/my plan.md', text: 'the plan' };

  it('is the text as it is without links', () => {
    expect(markdownWithLinks('just text', [])).toBe('just text');
  });

  it('writes each link in where its text is', () => {
    expect(markdownWithLinks('Read the setup guide and the plan.', [web, file]))
      .toBe('Read the [setup guide](https://docs.example.dev/setup) and [the plan](<docs/my plan.md>).');
  });

  it('matches a link whose text the selection lays out with other spaces', () => {
    expect(markdownWithLinks('the setup\nguide', [{ ...web, shown: 'setup guide' }]))
      .toBe('the [setup\nguide](https://docs.example.dev/setup)');
  });

  it('places two links with the same text in turn', () => {
    const a = { kind: 'web' as const, href: 'https://a.dev', text: 'here' };
    const b = { kind: 'web' as const, href: 'https://b.dev', text: 'here' };
    expect(markdownWithLinks('here or here', [a, b])).toBe('[here](https://a.dev) or [here](https://b.dev)');
  });

  it('leaves an address that is its own text as it is', () => {
    const bare = { kind: 'web' as const, href: 'https://example.com/a', text: 'https://example.com/a' };
    expect(markdownWithLinks('at https://example.com/a now', [bare])).toBe('at https://example.com/a now');
  });

  it('lists the links whose text it does not show after it', () => {
    const image = { kind: 'web' as const, href: 'https://ci.dev/run', text: 'build [passing]', shown: '' };
    const cut = { kind: 'web' as const, href: 'https://example.com/long', text: 'https://example.com/long', shown: 'https://exa' };
    expect(markdownWithLinks('and text', [image, cut]))
      .toBe('and text\n\n- [build \\[passing\\]](https://ci.dev/run)\n- https://example.com/long');
  });
});

describe('htmlWithLinks', () => {
  it('makes web links links and leaves file links as text, escaping the rest', () => {
    const links = [
      { kind: 'web' as const, href: 'https://x.dev/?a=1&b=2', text: 'docs' },
      { kind: 'file' as const, href: 'src/app.ts', text: 'app' },
    ];
    expect(htmlWithLinks('<b> docs\nand app', links))
      .toBe('&lt;b&gt; <a href="https://x.dev/?a=1&amp;b=2">docs</a><br>and app');
  });

  it("lists web links whose text it doesn't show after it", () => {
    expect(htmlWithLinks('text', [{ kind: 'web', href: 'https://ci.dev/run', text: 'build', shown: '' }]))
      .toBe('text<br><a href="https://ci.dev/run">build</a>');
  });
});
