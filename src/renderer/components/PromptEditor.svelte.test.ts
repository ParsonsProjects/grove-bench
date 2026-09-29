import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';

import PromptEditor from './PromptEditor.svelte';
import { messageStore } from '../stores/messages.svelte.js';

const SID = 'prompt-session';
const DRAFT = 'first line\nsecond line\nthird line\nfourth line';

describe('PromptEditor: sizes a restored draft', () => {
  // jsdom has no layout or ResizeObserver: stub both. A hidden textarea is
  // 0 wide; a shown one measures 20px a line plus 16px padding, from the
  // text it holds right now (so measuring before the draft is in reads 36).
  let width = 0;
  const observed = new Map<Element, ResizeObserverCallback>();
  function show(el: Element) {
    width = 600;
    observed.get(el)?.([], {} as ResizeObserver);
  }

  beforeEach(() => {
    width = 0;
    observed.clear();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) { observed.set(el, this.cb); }
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, 'clientWidth', {
      configurable: true, get: () => width,
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) { return width ? this.value.split('\n').length * 20 + 16 : 0; },
    });
    messageStore.draftBySession = { [SID]: DRAFT };
    messageStore.messagesBySession = { [SID]: [] };
    messageStore.promptInsertBySession = {};
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'clientWidth');
    Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight');
  });

  const textbox = (container: HTMLElement) => container.querySelector('textarea')!;

  it('fits the whole draft when it mounts shown', () => {
    width = 600;
    const { container } = render(PromptEditor, { sessionId: SID });
    expect(textbox(container).value).toBe(DRAFT);
    expect(textbox(container).style.height).toBe('96px');
  });

  it('waits until a hidden pane is shown, then fits the draft', () => {
    const { container } = render(PromptEditor, { sessionId: SID });
    const el = textbox(container);
    // Hidden: left at its natural height, not collapsed to 0.
    expect(el.style.height).toBe('');
    show(el);
    expect(el.style.height).toBe('96px');
  });

  it('keeps the 150px cap when a long draft is shown', () => {
    messageStore.draftBySession = { [SID]: Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n') };
    const { container } = render(PromptEditor, { sessionId: SID });
    const el = textbox(container);
    show(el);
    expect(el.style.height).toBe('150px');
  });
});
