import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

import MessageSearchBar from './MessageSearchBar.svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { EventSearchHit } from '../../shared/types.js';

const SID = 'search-bar-session';

const HITS: EventSearchHit[] = [
  { eventIndex: 12, kind: 'thinking', snippet: 'the parser is recursive' },
  { eventIndex: 5, kind: 'user', snippet: 'investigate the parser' },
];

beforeEach(() => {
  vi.useFakeTimers();
  mockGroveBench.searchEventHistory.mockResolvedValue(HITS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mockGroveBench.searchEventHistory.mockReset();
});

function renderBar() {
  const onclose = vi.fn();
  const onjump = vi.fn();
  const result = render(MessageSearchBar, { sessionId: SID, onclose, onjump });
  const input = result.getByPlaceholderText('Search full history...') as HTMLInputElement;
  return { ...result, onclose, onjump, input };
}

/** Type a query and let the 150ms debounce + async search resolve. */
async function typeQuery(input: HTMLInputElement, value: string) {
  await fireEvent.input(input, { target: { value } });
  await vi.advanceTimersByTimeAsync(150);
  await tick();
}

function resultButtons() {
  // Result rows are buttons that aren't the close (✕) button.
  return screen.getAllByRole('button').filter((b) => b.textContent !== '✕');
}

describe('MessageSearchBar (dropdown)', () => {
  it('debounces, queries the main-process search, and lists results', async () => {
    const { input, container } = renderBar();
    await typeQuery(input, 'parser');

    expect(mockGroveBench.searchEventHistory).toHaveBeenCalledWith(SID, 'parser');
    const rows = resultButtons();
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('recursive');
    expect(container.textContent).toContain('investigate');
  });

  it('does not query until the debounce elapses', async () => {
    const { input } = renderBar();
    await fireEvent.input(input, { target: { value: 'parser' } });
    // Before the debounce window, no IPC call yet.
    expect(mockGroveBench.searchEventHistory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(mockGroveBench.searchEventHistory).toHaveBeenCalledOnce();
  });

  it('clicking a result jumps to that hit', async () => {
    const { input, onjump } = renderBar();
    await typeQuery(input, 'parser');

    const row = resultButtons().find((b) => b.textContent?.includes('investigate'))!;
    await fireEvent.click(row);
    expect(onjump).toHaveBeenCalledWith(HITS[1]);
  });

  it('ArrowDown + Enter jumps to the selected hit', async () => {
    const { input, onjump } = renderBar();
    await typeQuery(input, 'parser');

    await fireEvent.keyDown(input, { key: 'ArrowDown' }); // move from hit 0 → hit 1
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onjump).toHaveBeenCalledWith(HITS[1]);
  });

  it('Enter on the default selection jumps to the first hit', async () => {
    const { input, onjump } = renderBar();
    await typeQuery(input, 'parser');

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onjump).toHaveBeenCalledWith(HITS[0]);
  });

  it('shows "no results" when the search returns nothing', async () => {
    mockGroveBench.searchEventHistory.mockResolvedValue([]);
    const { input, getByText } = renderBar();
    await typeQuery(input, 'zzz-nope');
    expect(getByText('no results')).toBeInTheDocument();
  });

  it('Escape closes the search', async () => {
    const { input, onclose } = renderBar();
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledOnce();
  });
});
