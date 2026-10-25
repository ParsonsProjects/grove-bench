import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import MarkdownPreviewPanel from './MarkdownPreviewPanel.svelte';

// jsdom has no Web Animations, which the panel's slide-in uses.
const realAnimate = Element.prototype.animate;
beforeEach(() => {
  Element.prototype.animate = vi.fn(() => ({ onfinish: null, cancel() {}, currentTime: 0 }) as unknown as Animation);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  markdownPreviewStore.close();
  Element.prototype.animate = realAnimate;
});

describe('MarkdownPreviewPanel code view', () => {
  it('shows a text file as numbered lines, with the lines a link named marked', async () => {
    const { container } = render(MarkdownPreviewPanel);
    markdownPreviewStore.showCode('a\nb\nc\n', 'notes.txt', 's1', { start: 2, end: 3 });
    await tick();
    const lines = [...container.querySelectorAll<HTMLElement>('.code-line')];
    expect(lines.map((l) => [l.dataset.line, l.textContent])).toEqual([['1', 'a'], ['2', 'b'], ['3', 'c']]);
    expect([...container.querySelectorAll<HTMLElement>('.code-line.target')].map((l) => l.dataset.line)).toEqual(['2', '3']);
    expect(container.querySelector('.markdown-content')).toBeNull();
  });

  it('scrolls the first linked line a third of the way down', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.matches('[data-line="40"]') ? 900 : 100 } as DOMRect;
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const scrolled = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    render(MarkdownPreviewPanel);
    markdownPreviewStore.showCode(Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n'), 'log.txt', 's1', { start: 40, end: 40 });
    await tick();
    // 800px below the panel's top, less a third of its 600px height.
    expect(scrolled).toHaveBeenLastCalledWith(600);
  });

  it('goes back to Markdown, from the top, for the next Markdown shown', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    const { container } = render(MarkdownPreviewPanel);
    markdownPreviewStore.showCode('a', 'notes.txt', 's1');
    await tick();
    markdownPreviewStore.show('# Plan', 'Plan', 's1');
    await tick();
    expect(container.querySelector('.code-line')).toBeNull();
    expect(container.querySelector('.markdown-content h1')?.textContent).toBe('Plan');
    expect(scrolled).toHaveBeenLastCalledWith(0);
  });
});
