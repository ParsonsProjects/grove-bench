import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MarkdownBlock from './MarkdownBlock.svelte';

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

const TABLE = ['| Name | Count |', '| --- | ---: |', '| **apples** | 3 |', '| pears | 5 |'].join('\n');

function stubClipboard() {
  const write = vi.fn().mockResolvedValue(undefined);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
  return { write, writeText };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it('copies the Markdown source as plain text and the rendered table as HTML', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write } = stubClipboard();
    render(MarkdownBlock, { content: `Before the table\n\n${TABLE}\n\nAfter the table` });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());

    const [[[item]]] = write.mock.calls as [[[FakeClipboardItem]]];
    expect(await item.items['text/plain'].text()).toBe(TABLE);
    const html = await item.items['text/html'].text();
    expect(html).toMatch(/^<table>/);
    expect(html).toContain('<strong>apples</strong>');
    expect(html).not.toContain('Before the table');
    expect(html).not.toContain('button');
  });

  it('falls back to the Markdown source when rich copy is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const { write, writeText } = stubClipboard();
    render(MarkdownBlock, { content: TABLE });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TABLE));
    expect(write).not.toHaveBeenCalled();
  });

  it('still copies code blocks as plain text', async () => {
    const { write, writeText } = stubClipboard();
    render(MarkdownBlock, { content: '```ts\nconst a = 1;\n```' });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));
    expect(write).not.toHaveBeenCalled();
  });
});
