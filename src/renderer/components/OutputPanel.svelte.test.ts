import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';

// MarkdownBlock (pulled in transitively) calls DOMPurify.addHook at module load.
// DOMPurify's default export resolves to a factory in this test environment, so
// stub it — these tests render no markdown (empty message list).
vi.mock('dompurify', () => ({
  default: { addHook: () => {}, sanitize: (html: string) => html },
}));

import OutputPanel from './OutputPanel.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { arrivalScene } from '../stores/arrivalScene.svelte.js';

const SID = 'panel-session';

beforeEach(() => {
  messageStore.messagesBySession = { [SID]: [] };
  messageStore.paginationBySession = {};
  store.sessions = [];
});

afterEach(() => cleanup());

async function pressCtrlF() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  await tick();
}

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

describe('OutputPanel: git identity notice', () => {
  it('shows the notice with its commands in the conversation', () => {
    store.activeSessionId = SID;
    messageStore.messagesBySession = { [SID]: [{ kind: 'git_identity_missing', id: 'g1' }] };
    const { getByRole } = render(OutputPanel, { sessionId: SID });
    expect(getByRole('note')).toHaveTextContent('git config --global user.email');
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
});

describe('OutputPanel: follows the conversation after being hidden', () => {
  // jsdom has no layout or ResizeObserver: stub both. A hidden element
  // measures 0; showing it resizes the container, which fires the observer.
  let resized: () => void;
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { resized = () => cb([], this as never); }
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

  it('ends when the agent stops without a reply', async () => {
    store.sessions = [session('running')];
    arrivalScene.begin(SID);
    render(OutputPanel, { sessionId: SID });
    store.sessions = [session('stopped')];
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

  it('copies a table under the pointer', async () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    messageStore.messagesBySession = { [SID]: [{ kind: 'text', id: 't1', text: table, uuid: '' }] };
    render(OutputPanel, { sessionId: SID });

    await fireEvent.contextMenu(screen.getByText('2'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy table' }));
    // No ClipboardItem in jsdom, so rich copy falls back to the Markdown.
    expect(writeText).toHaveBeenCalledWith(table);
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
    expect(insertSpy).toHaveBeenCalledWith(SID, 'pick these words');
    insertSpy.mockRestore();
  });
});
