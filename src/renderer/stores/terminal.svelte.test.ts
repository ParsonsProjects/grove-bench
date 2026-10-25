import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { terminalStore, COMMAND_SETTLED_MS, COMMAND_WINDOW_MS } from './terminal.svelte.js';
import { gitStatusStore } from './gitStatus.svelte.js';

const SID = 'term-1';
let output: (data: string) => void;

beforeEach(() => {
  vi.useFakeTimers();
  mockGroveBench.onPtyData.mockImplementation(((_id: string, handler: (data: string) => void) => {
    output = handler;
    return () => {};
  }) as never);
  vi.spyOn(gitStatusStore, 'scheduleRefresh').mockImplementation(() => {});
  terminalStore.subscribe(SID);
});

afterEach(() => {
  terminalStore.destroySession(SID);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('terminalStore: a command typed in the terminal', () => {
  it('reads the git status again once its output settles', () => {
    terminalStore.write(SID, 'git rebase main\r');
    output('Successfully rebased');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS - 1);
    output(' and updated refs/heads/feat.\r\n');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS - 1);
    expect(gitStatusStore.scheduleRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(gitStatusStore.scheduleRefresh).toHaveBeenCalledExactlyOnceWith(SID, 0);
  });

  it('waits for a long one to end, however long it goes quiet in between', () => {
    terminalStore.write(SID, 'npm install\r');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS);
    expect(gitStatusStore.scheduleRefresh).toHaveBeenCalledTimes(1);

    // Its last lines, a minute later, read it again.
    vi.advanceTimersByTime(60_000);
    output('added 812 packages\r\n');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS);
    expect(gitStatusStore.scheduleRefresh).toHaveBeenCalledTimes(2);
  });

  it('reads nothing for keys before Enter, or output long after it (a server left running)', () => {
    terminalStore.write(SID, 'git sta');
    output('git sta');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS * 2);
    expect(gitStatusStore.scheduleRefresh).not.toHaveBeenCalled();

    terminalStore.write(SID, 'tus\r');
    vi.advanceTimersByTime(COMMAND_WINDOW_MS);
    expect(gitStatusStore.scheduleRefresh).toHaveBeenCalledTimes(1);
    output('GET / 200\r\n');
    vi.advanceTimersByTime(COMMAND_SETTLED_MS);
    expect(gitStatusStore.scheduleRefresh).toHaveBeenCalledTimes(1);
  });

  it('forgets a waiting read when the thread goes', () => {
    terminalStore.write(SID, 'git pull\r');
    terminalStore.destroySession(SID);
    vi.advanceTimersByTime(COMMAND_SETTLED_MS);
    expect(gitStatusStore.scheduleRefresh).not.toHaveBeenCalled();
  });
});
