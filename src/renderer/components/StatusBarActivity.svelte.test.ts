import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { threadItemsStore } from '../stores/threadItems.svelte.js';

import StatusBarActivity from './StatusBarActivity.svelte';
import type { ThreadItems } from '../../shared/thread-items.js';

const ACTIVE = 's-active';
const HIDDEN = 's-hidden';

const ITEMS: ThreadItems = {
  tasks: [
    { id: '0', content: 'Read the code', status: 'completed' },
    { id: '1', content: 'Ship it', status: 'pending' },
  ],
  tasksEventIndex: 1,
  files: [
    { kind: 'made', made: { path: 'a.pdf', kind: 'pdf', size: 1 }, eventIndex: 2 },
    { kind: 'image', from: 'user', image: { file: 'a.png', name: 'mock.png' }, eventIndex: 3 },
  ],
};

beforeEach(() => {
  store.activeSessionId = ACTIVE;
  mockGroveBench.getThreadItems.mockReset();
  mockGroveBench.getThreadItems.mockResolvedValue(ITEMS);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.activeSessionId = null;
  threadItemsStore.destroy(ACTIVE);
  threadItemsStore.destroy(HIDDEN);
  messageStore.destroyAllSessions();
});

/** Open the lozenge's popup. */
async function openPopup() {
  await fireEvent.click(screen.getAllByTestId('activity')[0]);
  return screen.getByRole('dialog', { name: 'Activity' });
}

describe('StatusBarActivity', () => {
  it('says Ready when the agent is idle', () => {
    render(StatusBarActivity, { sessionId: ACTIVE });
    expect(screen.getByTestId('activity').textContent?.trim()).toBe('Ready');
  });

  it('loads the tasks and files of the open thread only', async () => {
    render(StatusBarActivity, { sessionId: ACTIVE });
    render(StatusBarActivity, { sessionId: HIDDEN });
    const popup = await openPopup();
    expect(await within(popup).findByRole('button', { name: /Tasks\s*1 of 2 done/ })).toBeInTheDocument();
    expect(within(popup).getByRole('button', { name: /Files\s*2 files/ })).toBeInTheDocument();
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledWith(ACTIVE);
  });

  it('opens the task list in the popup, with a way back', async () => {
    render(StatusBarActivity, { sessionId: ACTIVE });
    const popup = await openPopup();
    await fireEvent.click(await within(popup).findByRole('button', { name: /Tasks/ }));
    expect(within(popup).getAllByRole('listitem').map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Done: Read the code',
      'To do: Ship it',
    ]);

    await fireEvent.click(within(popup).getByRole('button', { name: 'Activity' }));
    expect(within(popup).getByTestId('activity-now')).toHaveTextContent('Ready');
  });

  it('starts from the summary each time it opens', async () => {
    render(StatusBarActivity, { sessionId: ACTIVE });
    let popup = await openPopup();
    await fireEvent.click(await within(popup).findByRole('button', { name: /Files/ }));
    expect(within(popup).queryByTestId('activity-now')).toBeNull();

    await fireEvent.click(screen.getByTestId('activity'));
    popup = await openPopup();
    expect(within(popup).getByTestId('activity-now')).toBeInTheDocument();
  });

  it('shows an image from the file list full size, over the bar', async () => {
    render(StatusBarActivity, { sessionId: ACTIVE });
    const popup = await openPopup();
    await fireEvent.click(await within(popup).findByRole('button', { name: /Files/ }));
    await fireEvent.click(within(popup).getByTitle(/^Open mock\.png/));

    expect(screen.queryByRole('dialog', { name: 'Activity' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'mock.png' })).toBeInTheDocument();
  });

  it('leaves the rows out when the thread has no tasks or files', async () => {
    mockGroveBench.getThreadItems.mockResolvedValue({ tasks: [], tasksEventIndex: null, files: [] });
    render(StatusBarActivity, { sessionId: ACTIVE });
    const popup = await openPopup();
    await vi.waitFor(() => expect(mockGroveBench.getThreadItems).toHaveBeenCalled());
    expect(within(popup).queryByRole('button', { name: /Tasks|Files/ })).toBeNull();
  });
});
