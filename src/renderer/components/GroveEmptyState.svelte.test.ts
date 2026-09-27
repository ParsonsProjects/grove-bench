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
    // Completed conversations are left out, like the sidebar's default view.
    expect(screen.queryByRole('button', { name: /feat-c/ })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /feat-b/ }));
    expect(store.activeSessionId).toBe('b');
    expect(store.needsAttention.b).toBeUndefined();
  });
});
