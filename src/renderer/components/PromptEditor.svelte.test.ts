import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import PromptEditor from './PromptEditor.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

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

describe('PromptEditor: rewind', () => {
  beforeEach(() => {
    messageStore.draftBySession = {};
    messageStore.messagesBySession = { [SID]: [] };
    messageStore.promptInsertBySession = {};
  });
  afterEach(() => cleanup());

  it('puts the rewound message in a prompt box that is already showing', async () => {
    const { container } = render(PromptEditor, { sessionId: SID });
    const el = container.querySelector('textarea')!;
    await fireEvent.input(el, { target: { value: 'half-typed' } });

    messageStore.ingestEvent(SID, { type: 'user_message', text: 'try again', uuid: 'cp-1' } as AgentEvent);
    messageStore.ingestEvent(SID, { type: 'rewind', toMessageId: 'cp-1' } as AgentEvent);
    await tick();

    expect(el.value).toBe('try again');
    expect(messageStore.getDraft(SID)).toBe('try again');
  });
});

describe('PromptEditor: editing a queued prompt', () => {
  beforeEach(() => {
    messageStore.draftBySession = {};
    messageStore.messagesBySession = { [SID]: [] };
    messageStore.promptInsertBySession = {};
    messageStore.queuedBySession = {};
    messageStore.queuePausedBySession = {};
    messageStore.isRunning = {};
  });
  afterEach(() => cleanup());

  it('queues the prompt as typed', async () => {
    messageStore.setIsRunning(SID, true);
    const { container } = render(PromptEditor, { sessionId: SID });
    const el = container.querySelector('textarea')!;
    await fireEvent.input(el, { target: { value: 'fix the tests' } });
    await fireEvent.keyDown(el, { key: 'Enter' });

    expect(messageStore.getQueue(SID)[0].typed).toEqual({ text: 'fix the tests', attachments: [] });
  });

  it('gets its text and attachments back, without the name prefix', async () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, {
      displayText: '[notes.txt] read this',
      outgoing: '<file name="notes.txt">hello</file>\n\nread this',
      typed: { text: 'read this', attachments: [{ type: 'text', name: 'notes.txt', content: 'hello' }] },
    });
    const { container, getByText } = render(PromptEditor, { sessionId: SID });

    await fireEvent.click(getByText('Edit'));
    await tick();

    expect(container.querySelector('textarea')!.value).toBe('read this');
    expect(getByText('notes.txt')).toBeInTheDocument();
    expect(messageStore.getQueue(SID)).toEqual([]);
  });
});

describe('PromptEditor: attachments', () => {
  beforeEach(() => {
    messageStore.draftBySession = {};
    messageStore.attachmentsBySession = {};
    messageStore.messagesBySession = { [SID]: [] };
    messageStore.promptInsertBySession = {};
  });
  afterEach(() => cleanup());

  it('keeps unsent attachments when the prompt box unmounts (another tab) and comes back', async () => {
    const first = render(PromptEditor, { sessionId: SID });
    messageStore.requestPromptInsert(SID, 'see this', { attachments: [{ type: 'text', name: 'notes.txt', content: 'hi' }] });
    await tick();
    expect(first.getByText('notes.txt')).toBeInTheDocument();
    first.unmount();

    const again = render(PromptEditor, { sessionId: SID });

    expect(again.getByText('notes.txt')).toBeInTheDocument();
  });
});
