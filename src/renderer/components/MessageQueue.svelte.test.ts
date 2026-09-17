import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import MessageQueue from './MessageQueue.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const SID = 'q1';

beforeEach(() => {
  messageStore.queuedBySession = {};
  messageStore.queuePausedBySession = {};
  messageStore.isRunning = {};
  messageStore.messagesBySession = {};
  messageStore.promptInsertBySession = {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function queueTwo() {
  messageStore.setIsRunning(SID, true);
  messageStore.submitMessage(SID, { displayText: 'update the README\nwith details', outgoing: 'update the README\nwith details' });
  messageStore.submitCommand(SID, '/compact');
}

describe('MessageQueue', () => {
  it('renders nothing when the queue is empty', () => {
    render(MessageQueue, { props: { sessionId: SID } });
    expect(screen.queryByTestId('message-queue')).not.toBeInTheDocument();
  });

  it('lists queued items in order, first line only, with a count', () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    expect(screen.getByTestId('message-queue')).toBeInTheDocument();
    expect(screen.getByText(/2 queued/)).toBeInTheDocument();
    expect(screen.getByText('update the README')).toBeInTheDocument();
    expect(screen.queryByText(/with details/)).not.toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText(/sends when the agent is free/)).toBeInTheDocument();
  });

  it('remove button drops just that item', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    const removeButtons = screen.getAllByLabelText('Remove queued message');
    await fireEvent.click(removeButtons[0]);

    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['/compact']);
    expect(screen.queryByText('update the README')).not.toBeInTheDocument();
    expect(screen.getByText(/1 queued/)).toBeInTheDocument();
  });

  it('Clear all empties the queue and hides the panel', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getByText('Clear all'));

    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(screen.queryByTestId('message-queue')).not.toBeInTheDocument();
  });

  it('Edit moves the text back to the prompt input', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getAllByText('Edit')[0]);

    expect(messageStore.getQueue(SID)).toHaveLength(1);
    expect(messageStore.promptInsertBySession[SID]?.text).toBe('update the README\nwith details');
  });

  it('shows paused state after Stop and Resume sends the next item', async () => {
    queueTwo();
    messageStore.markSessionStopped(SID);
    render(MessageQueue, { props: { sessionId: SID } });

    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('Resume'));

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'update the README\nwith details', undefined);
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['/compact']);
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });
});
