import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import ThreadViewSelect from './ThreadViewSelect.svelte';
import { messageStore, type ChatMessage } from '../stores/messages.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const SID = 'view-select-session';
const reply: ChatMessage = { kind: 'text', id: 'm1', text: 'Done', uuid: 'a1' };
const thinking = (i: number) => ({ kind: 'thinking', id: `th${i}`, thinking: 'Hmm' }) as ChatMessage;

afterEach(() => {
  cleanup();
  messageStore.messagesBySession = {};
  messageStore.viewModeBySession = {};
  store.activeSessionId = null;
});

describe('ThreadViewSelect', () => {
  it("counts what the view hides, in a hidden conversation once it's open", async () => {
    store.activeSessionId = SID;
    messageStore.setViewMode(SID, 'summary');
    messageStore.messagesBySession = { [SID]: [reply, thinking(1)] };
    render(ThreadViewSelect, { sessionId: SID });
    const picker = screen.getByLabelText(/^Thread view/);
    expect(picker).toHaveAttribute('aria-label', 'Thread view: Summary, 1 hidden');

    store.activeSessionId = 'another';
    await tick();
    messageStore.messagesBySession = { [SID]: [reply, thinking(1), thinking(2)] };
    await tick();
    expect(picker).toHaveAttribute('aria-label', 'Thread view: Summary, 1 hidden');

    store.activeSessionId = SID;
    await tick();
    expect(picker).toHaveAttribute('aria-label', 'Thread view: Summary, 2 hidden');
  });
});
