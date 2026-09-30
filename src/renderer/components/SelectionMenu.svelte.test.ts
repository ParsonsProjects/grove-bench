import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import SelectionMenu from './SelectionMenu.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';

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
