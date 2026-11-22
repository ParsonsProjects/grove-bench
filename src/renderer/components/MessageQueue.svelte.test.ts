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
  messageStore.queuedEditBySession = {};
  messageStore.destroyAllSessions();
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

  it('Clear queue empties the queue, hides the panel and offers Undo', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getByText('Clear queue'));

    expect(messageStore.getQueue(SID)).toEqual([]);
    expect(screen.queryByTestId('message-queue')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Queue cleared.');

    await fireEvent.click(screen.getByText('Undo'));

    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['update the README\nwith details', '/compact']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows Merge and Clear queue only for two or more messages', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'one', outgoing: 'one' });
    render(MessageQueue, { props: { sessionId: SID } });

    expect(screen.queryByText('Merge')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear queue')).not.toBeInTheDocument();
  });

  it("can't merge a queue with a command in it, and says why", () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    const merge = screen.getByText('Merge').closest('button')!;
    expect(merge).toBeDisabled();
    expect(merge).toHaveAttribute('title', "Commands can't be merged with other messages");
  });

  it('Merge joins the messages into one', async () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'first', outgoing: 'first' });
    messageStore.submitMessage(SID, { displayText: 'second', outgoing: 'second' });
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getByText('Merge'));

    expect(messageStore.getQueue(SID).map((m) => m.outgoing)).toEqual(['first\n\nsecond']);
    expect(screen.getByRole('status')).toHaveTextContent('2 messages merged into one.');
  });

  it('Edit opens the message in the box and keeps it in its place', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getAllByText('Edit')[0]);

    expect(messageStore.getQueue(SID)).toHaveLength(2);
    expect(messageStore.getQueuedEdit(SID)).toMatchObject({ position: 1 });
    expect(messageStore.promptInsertBySession[SID]?.text).toBe('update the README\nwith details');
    expect(screen.getByText('editing')).toBeInTheDocument();
  });

  it('the arrows change the order, and the end ones are disabled', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });

    const ups = screen.getAllByLabelText('Move up');
    const downs = screen.getAllByLabelText('Move down');
    expect(ups[0]).toBeDisabled();
    expect(downs[1]).toBeDisabled();

    await fireEvent.click(downs[0]);

    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['/compact', 'update the README\nwith details']);
  });

  it('clicking a message shows the whole of it', async () => {
    queueTwo();
    render(MessageQueue, { props: { sessionId: SID } });
    expect(screen.getByText('+1 line')).toBeInTheDocument();

    await fireEvent.click(screen.getByText('update the README'));

    expect(screen.getByText(/update the README\s+with details/)).toBeInTheDocument();
    expect(screen.queryByText('+1 line')).not.toBeInTheDocument();
  });

  it('Send sends one message now while the agent is idle; the rest stay paused', async () => {
    queueTwo();
    messageStore.markSessionStopped(SID);
    render(MessageQueue, { props: { sessionId: SID } });

    await fireEvent.click(screen.getAllByText('Send')[1]);

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, '/compact');
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['update the README\nwith details']);
    expect(messageStore.isQueuePaused(SID)).toBe(true);
  });

  it('marks a message the agent never read', () => {
    messageStore.setIsRunning(SID, true);
    messageStore.submitMessage(SID, { displayText: 'one', outgoing: 'one' });
    messageStore.queuedBySession = { [SID]: [{ ...messageStore.getQueue(SID)[0], notRead: true }] };
    render(MessageQueue, { props: { sessionId: SID } });

    expect(screen.getByText('not read')).toBeInTheDocument();
  });

  it('shows paused state after Stop and Resume sends the next item', async () => {
    queueTwo();
    messageStore.markSessionStopped(SID);
    render(MessageQueue, { props: { sessionId: SID } });

    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('Resume'));

    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, 'update the README\nwith details', undefined, undefined);
    expect(messageStore.getQueue(SID).map((m) => m.displayText)).toEqual(['/compact']);
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });
});
