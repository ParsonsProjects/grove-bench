import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boardStore } from './board.svelte.js';
import { store } from './sessions.svelte.js';

beforeEach(() => {
  store.sessions = [
    { id: 'a', branch: 'feat/a', repoPath: '/web', status: 'running' },
    { id: 'b', branch: 'feat/b', repoPath: '/web', status: 'running' },
  ] as any;
  store.activeSessionId = 'a';
  store.needsAttention = {};
  boardStore.close();
});

afterEach(() => {
  boardStore.close();
  store.sessions = [];
  store.activeSessionId = null;
});

describe('boardStore', () => {
  it('takes the main pane: no thread is open while it shows', () => {
    boardStore.show();
    expect(boardStore.open).toBe(true);
    expect(store.activeSessionId).toBeNull();
  });

  it('goes back to the thread that was open from List', () => {
    boardStore.show();
    boardStore.showList();
    expect(boardStore.open).toBe(false);
    expect(store.activeSessionId).toBe('a');
  });

  it("doesn't reopen a thread that was closed while the board showed", () => {
    boardStore.show();
    store.updateStatus('a', 'stopped');
    boardStore.showList();
    expect(store.activeSessionId).toBeNull();
  });

  it('opens a card\'s thread, closes the board and marks the thread read', () => {
    store.needsAttention = { b: true };
    boardStore.show();
    boardStore.openThread('b');
    expect(boardStore.open).toBe(false);
    expect(store.activeSessionId).toBe('b');
    expect(store.needsAttention.b).toBeUndefined();
  });

  it('forgets the thread to go back to once something else closes it', () => {
    boardStore.show();
    boardStore.close();
    store.activeSessionId = null;
    boardStore.show();
    boardStore.showList();
    expect(store.activeSessionId).toBeNull();
  });

  it('ignores a second show, so the thread to go back to is kept', () => {
    boardStore.show();
    boardStore.show();
    boardStore.showList();
    expect(store.activeSessionId).toBe('a');
  });
});
