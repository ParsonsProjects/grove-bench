import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import GroveEmptyState from './GroveEmptyState.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.activeSessionId = null;
  store.needsAttention = {};
  store.deferredResume = {};
  store.showCompleted = false;
  store.sessionSort = { key: 'name', dir: 'asc' };
  messageStore.messagesBySession = {};
  messageStore.isRunning = {};
});

describe('GroveEmptyState', () => {
  it('shows the empty bench when there are no conversations', () => {
    render(GroveEmptyState, { variant: 'empty' });
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    expect(screen.getByText('+ Conversation')).toBeInTheDocument();
  });

  it('seats each open conversation with its status and opens it on click', async () => {
    store.sessions = [
      { id: 'a', branch: 'feat-a', repoPath: '/r', status: 'running', displayName: 'Working one', lastActiveAt: 3 },
      { id: 'b', branch: 'feat-b', repoPath: '/r', status: 'running', lastActiveAt: 2 },
      { id: 'c', branch: 'feat-c', repoPath: '/r', status: 'stopped', completedAt: 1, lastActiveAt: 1 },
    ] as any;
    messageStore.setIsRunning('a', true);
    messageStore.messagesBySession['b'] = [
      { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Write', toolInput: {}, toolUseId: 't1', resolved: false },
    ] as any;
    store.needsAttention = { b: true };

    render(GroveEmptyState, { variant: 'pick' });

    const working = screen.getByRole('button', { name: /Working one/ });
    expect(working).toContainElement(screen.getByRole('img', { name: 'Working' }));
    expect(screen.getByRole('img', { name: 'Waiting for you' })).toBeInTheDocument();
    // Stopped and completed conversations are left out, like the sidebar's Conversations list.
    expect(screen.queryByRole('button', { name: /feat-c/ })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /feat-b/ }));
    expect(store.activeSessionId).toBe('b');
    expect(store.needsAttention.b).toBeUndefined();
  });

  it('lists exactly the sidebar Conversations, in the sidebar sort order', () => {
    store.sessions = [
      { id: 'old', branch: 'zulu', repoPath: '/r', status: 'running', lastActiveAt: 1 },
      { id: 'closed', branch: 'alpha', repoPath: '/r', status: 'stopped', lastActiveAt: 99 },
      { id: 'restored', branch: 'mike', repoPath: '/r', status: 'stopped', lastActiveAt: 2 },
      { id: 'done', branch: 'bravo', repoPath: '/r', status: 'running', completedAt: 5, lastActiveAt: 50 },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, branch: `echo-${i}`, repoPath: '/r', status: 'running', lastActiveAt: 10 + i })),
    ] as any;
    store.deferResume('restored');
    store.sessionSort = { key: 'name', dir: 'asc' };

    render(GroveEmptyState, { variant: 'pick' });

    const names = () => screen.getAllByRole('button').map((b) => b.getAttribute('title'));
    // Every open tab (no cap), a restored tab waiting to reconnect included; a stopped one is not.
    expect(names()).toEqual(['echo-0', 'echo-1', 'echo-2', 'echo-3', 'echo-4', 'echo-5', 'mike', 'zulu']);

    cleanup();
    store.showCompleted = true;
    store.sessionSort = { key: 'age', dir: 'desc' };
    render(GroveEmptyState, { variant: 'pick' });
    expect(names()).toEqual(['bravo', 'echo-5', 'echo-4', 'echo-3', 'echo-2', 'echo-1', 'echo-0', 'mike', 'zulu']);
  });

  it('points to the sidebar when no conversation is open', () => {
    store.sessions = [{ id: 'a', branch: 'feat-a', repoPath: '/r', status: 'stopped' }] as any;

    render(GroveEmptyState, { variant: 'pick' });

    expect(screen.getByText('No open conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
