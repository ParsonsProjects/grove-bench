import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';

import GroveMap from './GroveMap.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

// jsdom has no canvas: say so quietly, as a real one would draw the scenery.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.needsAttention = {};
  store.deferredResume = {};
  messageStore.messagesBySession = {};
  messageStore.isRunning = {};
});

function seed() {
  store.repos = ['/code/app', '/code/site'];
  store.sessions = [
    { id: 'a', branch: 'feat-a', repoPath: '/code/app', status: 'running', displayName: 'Fix the dates', lastActiveAt: 4 },
    { id: 'b', branch: 'feat-b', repoPath: '/code/app', status: 'running', displayName: 'Console filters', lastActiveAt: 3 },
    { id: 'c', branch: 'feat-c', repoPath: '/code/site', status: 'error', displayName: 'Refund export', lastActiveAt: 2 },
    { id: 'd', branch: 'feat-d', repoPath: '/code/site', status: 'stopped', lastActiveAt: 1 },
  ] as never;
  messageStore.setIsRunning('a', true);
  messageStore.messagesBySession['b'] = [
    { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Bash', toolInput: {}, toolUseId: 't1', resolved: false },
  ] as never;
}

describe('GroveMap', () => {
  it('seats each open thread in its project room, with its status', () => {
    seed();
    render(GroveMap);
    expect(screen.getByRole('heading', { name: 'Pick a thread' })).toBeInTheDocument();

    const app = screen.getByRole('region', { name: 'app' });
    expect(within(app).getByRole('button', { name: 'Fix the dates: Working' })).toBeInTheDocument();
    expect(within(app).getByRole('button', { name: 'Console filters: Waiting for you' })).toBeInTheDocument();
    const site = screen.getByRole('region', { name: 'site' });
    expect(within(site).getByRole('button', { name: 'Refund export: Error' })).toBeInTheDocument();
    // Closed threads are left out, as in Pick a thread and the sidebar.
    expect(screen.queryByRole('button', { name: /feat-d/ })).toBeNull();
  });

  it('puts a banner over threads that need you or failed', () => {
    seed();
    render(GroveMap);
    expect(within(screen.getByRole('button', { name: /Console filters/ })).getByText('Needs you')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Refund export/ })).getByText('Error')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Fix the dates/ })).queryByText('Needs you')).toBeNull();
  });

  it('opens a thread when you click its person', async () => {
    seed();
    store.needsAttention = { c: true };
    render(GroveMap);
    await fireEvent.click(screen.getByRole('button', { name: /Refund export/ }));
    expect(store.activeSessionId).toBe('c');
    expect(store.needsAttention.c).toBeFalsy();
  });

  it("doesn't open anyone at the end of a drag", async () => {
    seed();
    render(GroveMap);
    const seat = screen.getByRole('button', { name: /Fix the dates/ });
    const viewport = seat.closest('.map-viewport')!;
    await fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    await fireEvent.pointerMove(viewport, { clientX: 160, clientY: 130, pointerId: 1 });
    await fireEvent.pointerUp(viewport, { pointerId: 1 });
    await fireEvent.click(seat);
    expect(store.activeSessionId).toBeNull();

    // A plain click afterwards opens it.
    await fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    await fireEvent.pointerUp(viewport, { pointerId: 1 });
    await fireEvent.click(seat);
    expect(store.activeSessionId).toBe('a');
  });
});
