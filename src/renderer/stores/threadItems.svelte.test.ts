import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { REFRESH_DELAY_MS, threadItemsStore } from './threadItems.svelte.js';
import { messageStore } from './messages.svelte.js';
import type { ThreadItems } from '../../shared/thread-items.js';

const SID = 's1';
const items = (content: string): ThreadItems => ({
  tasks: [{ id: '0', content, status: 'pending' }],
  tasksEventIndex: 3,
  files: [],
});

beforeEach(() => {
  threadItemsStore.destroy(SID);
  mockGroveBench.getThreadItems.mockReset();
  mockGroveBench.getThreadItems.mockResolvedValue(items('first'));
});

afterEach(() => {
  vi.useRealTimers();
  messageStore.destroyAllSessions();
});

describe('threadItemsStore', () => {
  it('loads a thread once on ensure', async () => {
    threadItemsStore.ensure(SID);
    threadItemsStore.ensure(SID);
    await vi.waitFor(() => expect(threadItemsStore.get(SID)?.tasks[0].content).toBe('first'));
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledWith(SID);
  });

  it('keeps the newest answer when an older one lands last', async () => {
    let answerFirst!: (v: ThreadItems) => void;
    mockGroveBench.getThreadItems
      .mockImplementationOnce(() => new Promise<ThreadItems>((r) => { answerFirst = r; }))
      .mockResolvedValueOnce(items('second'));
    const first = threadItemsStore.load(SID);
    await threadItemsStore.load(SID);
    answerFirst(items('first'));
    await first;
    expect(threadItemsStore.get(SID)?.tasks[0].content).toBe('second');
  });

  it('loads again shortly after live events that may change the lists, once for a burst', async () => {
    vi.useFakeTimers();
    await threadItemsStore.load(SID);
    mockGroveBench.getThreadItems.mockResolvedValue(items('after'));

    threadItemsStore.noteEvent(SID, { type: 'files_made', files: [] });
    threadItemsStore.noteEvent(SID, { type: 'user_message', text: 'hi' });
    threadItemsStore.noteEvent(SID, { type: 'assistant_text', text: 'x', uuid: 'u' });
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(2);
    expect(threadItemsStore.get(SID)?.tasks[0].content).toBe('after');
  });

  it('ignores events that cannot change the lists, and threads never loaded', async () => {
    vi.useFakeTimers();
    threadItemsStore.noteEvent(SID, { type: 'files_made', files: [] });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
    expect(mockGroveBench.getThreadItems).not.toHaveBeenCalled();

    await threadItemsStore.load(SID);
    threadItemsStore.noteEvent(SID, { type: 'partial_text', text: 'x' });
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);
  });

  it('drops a thread and its pending refresh on destroy', async () => {
    vi.useFakeTimers();
    await threadItemsStore.load(SID);
    threadItemsStore.noteEvent(SID, { type: 'files_made', files: [] });
    threadItemsStore.destroy(SID);
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS);
    expect(threadItemsStore.get(SID)).toBeUndefined();
    expect(mockGroveBench.getThreadItems).toHaveBeenCalledTimes(1);
  });

  it('hears live events through the message store, but not replayed history', async () => {
    await threadItemsStore.load(SID);
    const note = vi.spyOn(threadItemsStore, 'noteEvent');
    messageStore.replayEvents(SID, [{ type: 'user_message', text: 'old' }]);
    expect(note).not.toHaveBeenCalled();
    messageStore.ingestEvent(SID, { type: 'user_message', text: 'new' });
    expect(note).toHaveBeenCalledWith(SID, { type: 'user_message', text: 'new' });
  });
});
