import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import CutOffBlock from './CutOffBlock.svelte';
import CutOffToast from './CutOffToast.svelte';
import { messageStore, type ChatCutOffMessage } from '../stores/messages.svelte.js';
import { CONTINUE_PROMPT } from '../../shared/cut-off.js';

const SID = 'cut-off-session';

/** The thread as it comes back after an update cut its turn off. */
function reopened(): ChatCutOffMessage {
  messageStore.messagesBySession = {};
  messageStore.queuedBySession = {};
  messageStore.replayEvents(SID, [
    { type: 'user_message', text: 'Run the tests', uuid: 'p1' },
    { type: 'turn_cut_off', reason: 'update' },
    { type: 'process_exit' },
  ]);
  return messageStore.getMessages(SID)[1] as ChatCutOffMessage;
}

beforeEach(() => {
  mockGroveBench.sendMessage.mockClear();
  mockGroveBench.dismissCutOff.mockClear();
});

afterEach(() => {
  cleanup();
  messageStore.messagesBySession = {};
  messageStore.queuedBySession = {};
});

describe('CutOffBlock', () => {
  it('offers Continue, which sends the continue prompt, and then becomes a line', async () => {
    const message = reopened();
    render(CutOffBlock, { sessionId: SID, message });
    expect(screen.getByText('This turn was cut off')).toBeInTheDocument();
    expect(screen.getByText(/Grove Bench closed to install an update, while the agent was still working\. Its last step may not have finished\./)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(mockGroveBench.sendMessage).toHaveBeenCalledWith(SID, CONTINUE_PROMPT, undefined, undefined, { continued: true });
    expect(await screen.findByText('Cut off when Grove Bench closed to install an update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
  });

  it('Dismiss leaves the thread as it is, and tells main', async () => {
    const message = reopened();
    render(CutOffBlock, { sessionId: SID, message });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(mockGroveBench.dismissCutOff).toHaveBeenCalledWith(SID);
    expect(mockGroveBench.sendMessage).not.toHaveBeenCalled();
    expect(await screen.findByText('Cut off when Grove Bench closed to install an update')).toBeInTheDocument();
  });
});

describe('CutOffToast', () => {
  const thread = (id: string, name: string) => ({ id, name, cutOff: { reason: 'update' as const } });

  it('names the threads, says why once, and offers Continue all and Show them', async () => {
    const calls: string[] = [];
    render(CutOffToast, {
      threads: [thread('a', 'fix-date-tests'), thread('b', 'pr-actions')],
      onContinueAll: () => calls.push('continue'),
      onShow: () => calls.push('show'),
      onClose: () => calls.push('close'),
    });
    expect(screen.getByText('2 turns were cut off')).toBeInTheDocument();
    expect(screen.getByText(/closed to install an update.*Threads: fix-date-tests and pr-actions\./s)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Continue all/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(calls).toEqual(['continue', 'show', 'close']);
  });

  it('shows nothing with no threads', () => {
    render(CutOffToast, { threads: [], onContinueAll: () => {}, onShow: () => {}, onClose: () => {} });
    expect(screen.queryByTestId('cut-off-toast')).not.toBeInTheDocument();
  });
});
