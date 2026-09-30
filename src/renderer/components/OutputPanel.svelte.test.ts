import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/svelte';
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
    vi.spyOn(messageStore, 'loadOlderUntil').mockImplementation(((_sid: string, eventIndex: number) =>
      eventIndex === 1 ? new Promise<void>((r) => { finishPaging = r; }) : Promise.resolve()) as never);
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

  it('keeps the oldest rendered message while scrolled up and new ones arrive', async () => {
    messageStore.messagesBySession = {
      [SID]: Array.from({ length: 60 }, (_, i) => ({ kind: 'text', id: `m${i}`, text: `reply ${i}`, uuid: `a${i}` })),
    };
    messageStore.setViewMode(SID, 'detailed');
    const { container, findByTitle } = render(OutputPanel, { sessionId: SID });
    const el = scroller(container);
    expect(container.querySelector('[data-msg-id="m10"]')).not.toBeNull();
    measure(el, { scrollTop: 0, scrollHeight: 5000, clientHeight: 500 });
    el.dispatchEvent(new Event('scroll'));
    await findByTitle('Scroll to bottom');

    messageStore.ingestEvent(SID, { type: 'assistant_text', text: 'reply 60', uuid: 'a60' } as never);
    await tick();

    expect(container.querySelector('[data-msg-id="m10"]')).not.toBeNull();
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
