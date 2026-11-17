import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import SelectionMenu from './SelectionMenu.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { bookmarkStore } from '../stores/bookmarks.svelte.js';

const SID = 'selection-session';

describe('SelectionMenu: To prompt', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // jsdom's Range has no layout.
    Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 50, bottom: 60 }) as DOMRect;
    store.activeSessionId = SID;
    messageStore.draftBySession = { [SID]: 'already typed' };
    messageStore.promptInsertBySession = {};
    container = document.createElement('div');
    container.textContent = 'const answer = 42;';
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanup();
    container.remove();
    window.getSelection()?.removeAllRanges();
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  });

  it('keeps the selection in the draft when no prompt box is showing', async () => {
    render(SelectionMenu, { sessionId: SID, container });
    const range = document.createRange();
    range.selectNodeContents(container);
    window.getSelection()!.addRange(range);
    await fireEvent.mouseUp(container);

    await fireEvent.click(await screen.findByText('To prompt'));

    expect(messageStore.getDraft(SID)).toBe('already typed\nconst answer = 42;');
  });
});

describe('SelectionMenu: links in the selection', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 50, bottom: 60 }) as DOMRect;
    store.activeSessionId = SID;
    store.sessions = [{ id: SID, branch: 'feat-x', repoPath: '/repo', status: 'running' }] as never;
    messageStore.draftBySession = {};
    messageStore.promptInsertBySession = {};
    container = document.createElement('div');
    container.innerHTML = '<div data-msg-id="m1">Read the <a href="https://docs.example.dev/setup">setup guide</a></div>';
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanup();
    container.remove();
    window.getSelection()?.removeAllRanges();
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
    bookmarkStore.list = [];
    store.sessions = [];
  });

  async function select() {
    render(SelectionMenu, { sessionId: SID, container });
    const range = document.createRange();
    range.selectNodeContents(container.querySelector('[data-msg-id]')!);
    window.getSelection()!.addRange(range);
    await fireEvent.mouseUp(container);
  }

  it('keeps them in the bookmark', async () => {
    const add = vi.spyOn(bookmarkStore, 'add').mockImplementation(async (b) => ({ ...b, id: 'b1', createdAt: 0 }));
    await select();

    await fireEvent.click(await screen.findByText('Bookmark'));

    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0][0]).toMatchObject({
      selectedText: 'Read the setup guide',
      links: [{ kind: 'web', href: 'https://docs.example.dev/setup', text: 'setup guide' }],
    });
    // Only what's saved: not how the selection showed it.
    expect(add.mock.calls[0][0].links![0]).not.toHaveProperty('shown');
  });

  it('writes them into the prompt', async () => {
    await select();

    await fireEvent.click(await screen.findByText('To prompt'));

    expect(messageStore.getDraft(SID)).toBe('Read the [setup guide](https://docs.example.dev/setup)');
  });
});
