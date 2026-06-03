import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import MessageSearchBar from './MessageSearchBar.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

const SID = 'search-bar-session';

const MESSAGES: ChatMessage[] = [
  { kind: 'user', id: 'u1', text: 'investigate the parser' },
  { kind: 'text', id: 't1', text: 'the parser is recursive', uuid: '' },
  { kind: 'system', id: 's1', text: 'unrelated note' },
];

beforeEach(() => {
  messageStore.messagesBySession = { [SID]: MESSAGES };
  // Ensure no "older history loading" indicator interferes.
  messageStore.paginationBySession = {};
});

afterEach(() => cleanup());

function renderBar() {
  const onclose = vi.fn();
  const onmatchchange = vi.fn();
  const result = render(MessageSearchBar, { sessionId: SID, onclose, onmatchchange });
  const input = result.getByPlaceholderText('Search messages...') as HTMLInputElement;
  return { ...result, onclose, onmatchchange, input };
}

describe('MessageSearchBar', () => {
  it('renders a focused search input', async () => {
    const { input } = renderBar();
    await tick();
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('reports matches across message kinds and shows the count', async () => {
    const { input, onmatchchange, getByText } = renderBar();
    await fireEvent.input(input, { target: { value: 'parser' } });
    await tick();

    const lastCall = onmatchchange.mock.calls.at(-1)!;
    expect(lastCall[0]).toEqual(['u1', 't1']); // matching message ids, in order
    expect(getByText('1 of 2')).toBeInTheDocument();
  });

  it('shows "no results" when nothing matches', async () => {
    const { input, getByText } = renderBar();
    await fireEvent.input(input, { target: { value: 'zzz-nope' } });
    await tick();
    expect(getByText('no results')).toBeInTheDocument();
  });

  it('Enter advances to the next match', async () => {
    const { input, onmatchchange, getByText } = renderBar();
    await fireEvent.input(input, { target: { value: 'parser' } });
    await tick();

    await fireEvent.keyDown(input, { key: 'Enter' });
    await tick();

    expect(getByText('2 of 2')).toBeInTheDocument();
    const lastCall = onmatchchange.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe(1); // currentIndex advanced
  });

  it('Shift+Enter wraps to the previous match', async () => {
    const { input, getByText } = renderBar();
    await fireEvent.input(input, { target: { value: 'parser' } });
    await tick();

    // From match 1 of 2, Shift+Enter wraps backwards to 2 of 2.
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await tick();
    expect(getByText('2 of 2')).toBeInTheDocument();
  });

  it('Escape closes the search', async () => {
    const { input, onclose } = renderBar();
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('the close button closes the search', async () => {
    const { onclose, getByTitle } = renderBar();
    await fireEvent.click(getByTitle('Close (Esc)'));
    expect(onclose).toHaveBeenCalledOnce();
  });
});
