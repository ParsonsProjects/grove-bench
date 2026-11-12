// The clean-up dialog's Remove flow, end to end: what gets removed, with
// which branch setting, and what happens when one removal fails.
// Selection and checks are in Sidebar.svelte.test.ts ("Sidebar clean-up dialog").
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte';

import Sidebar from './Sidebar.svelte';
import { store } from '../stores/sessions.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const DAY = 86_400_000;
const longAgo = Date.now() - 30 * DAY;

beforeEach(() => {
  vi.clearAllMocks();
  store.repos = ['/repo-a'];
  store.sessions = [
    { id: 'live', branch: 'feat-live', repoPath: '/repo-a', status: 'running', displayName: 'Live one' },
    { id: 'a', branch: 'feat-a', repoPath: '/repo-a', status: 'stopped', displayName: 'Alpha', lastActiveAt: longAgo - 2 * DAY },
    { id: 'b', branch: 'feat-b', repoPath: '/repo-a', status: 'stopped', displayName: 'Bravo', lastActiveAt: longAgo - DAY },
    { id: 'dirty', branch: 'feat-dirty', repoPath: '/repo-a', status: 'stopped', displayName: 'Dirty', lastActiveAt: longAgo },
    { id: 'recent', branch: 'feat-recent', repoPath: '/repo-a', status: 'stopped', displayName: 'Recent', lastActiveAt: Date.now() - DAY },
  ] as any;
  store.activeSessionId = 'live';
  store.prerequisites = { git: { available: true }, agent: { available: true }, gh: { available: false } } as any;
  mockGroveBench.getSessionPreviews.mockResolvedValue({});
  mockGroveBench.getGitStatus.mockImplementation((async (id: string) => ({
    entries: id === 'dirty' ? [{ filePath: 'x.ts', status: 'modified' as const, staged: false }] : [],
  })));
  mockGroveBench.destroySession.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  store.prerequisites = null;
  store.error = null;
  mockGroveBench.getGitStatus.mockReset();
  mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
});

async function openAndWait() {
  render(Sidebar);
  await fireEvent.click(screen.getByTitle('Clean up old threads'));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByLabelText(/Alpha/)).toBeChecked());
  await waitFor(() => expect(screen.getByText('· uncommitted changes')).toBeInTheDocument());
}

async function removeAndConfirm() {
  await fireEvent.click(screen.getByRole('button', { name: /^Remove \d+ threads?$/ }));
  const confirm = await screen.findByRole('dialog', { name: 'Remove Threads?' });
  await fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
}

describe('Sidebar clean-up Remove', () => {
  it('removes only the preticked clean candidates, oldest first, keeping branches', async () => {
    await openAndWait();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/Recent/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Live one/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Dirty/)).not.toBeChecked();
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();

    await removeAndConfirm();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockGroveBench.destroySession.mock.calls).toEqual([['a', false], ['b', false]]);
    expect(store.sessions.map((s) => s.id).sort()).toEqual(['dirty', 'live', 'recent']);
  });

  it('passes deleteBranch=true when "Also delete their branches" is ticked', async () => {
    await openAndWait();
    await fireEvent.click(screen.getByText('Also delete their branches'));
    await removeAndConfirm();
    await waitFor(() => expect(mockGroveBench.destroySession).toHaveBeenCalledTimes(2));
    expect(mockGroveBench.destroySession.mock.calls).toEqual([['a', true], ['b', true]]);
  });

  it('warns in the confirm step when a ticked thread has uncommitted changes', async () => {
    await openAndWait();
    await fireEvent.click(screen.getByLabelText(/Dirty/));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove 3 threads' }));
    expect(await screen.findByText('1 of them has uncommitted changes that will be lost.')).toBeInTheDocument();
  });

  it('keeps going after one removal fails, and keeps the failed thread listed', async () => {
    mockGroveBench.destroySession.mockImplementation(async (id: string) => {
      if (id === 'a') throw new Error('Another thread is still working in this thread\'s worktree.');
    });
    await openAndWait();
    await removeAndConfirm();
    await waitFor(() => expect(mockGroveBench.destroySession).toHaveBeenCalledTimes(2));
    expect(store.sessions.some((s) => s.id === 'a')).toBe(true);
    expect(store.sessions.some((s) => s.id === 'b')).toBe(false);
    expect(String(store.error)).toContain('still working');
  });
});
