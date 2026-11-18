import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';

import FollowUpsDrawer from './FollowUpsDrawer.svelte';
import { followUpsStore } from '../stores/followUps.svelte.js';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import type { FollowUp } from '../../shared/follow-ups.js';

function fu(extra: Partial<FollowUp> = {}): FollowUp {
  return { id: 'a1b2c3', repoPath: '/repo-a', title: 'Add tests for refresh', details: 'Cover the expired token path.', createdAt: Date.now(), ...extra };
}

beforeEach(() => {
  followUpsStore.list = [];
  followUpsStore.ready = true;
  followUpsStore.drawerOpen = true;
  store.repos = ['/repo-a', '/repo-b'];
  store.sessions = [];
  store.activeSessionId = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  followUpsStore.drawerOpen = false;
  store.repos = [];
});

describe('FollowUpsDrawer', () => {
  it('renders nothing when the drawer is closed', () => {
    followUpsStore.drawerOpen = false;
    render(FollowUpsDrawer);
    expect(screen.queryByRole('complementary', { name: 'Follow-ups' })).not.toBeInTheDocument();
  });

  it('says what follow-ups are when there are none', () => {
    render(FollowUpsDrawer);
    expect(screen.getByText(/No follow-ups yet/)).toBeInTheDocument();
  });

  it('says it is loading until the list has been read', () => {
    followUpsStore.ready = false;
    render(FollowUpsDrawer);
    expect(screen.getByText(/Loading follow-ups/)).toBeInTheDocument();
  });

  it('shows each open one with its details and the thread that added it, which it can open', async () => {
    store.sessions = [{ id: 's1', branch: 'claude/login', repoPath: '/repo-a', status: 'running', displayName: 'Fix login' }];
    followUpsStore.list = [fu({ fromSessionId: 's1', fromLabel: 'Fix login' })];
    render(FollowUpsDrawer);
    const card = screen.getByRole('article', { name: 'Add tests for refresh' });
    expect(within(card).getByText('Cover the expired token path.')).toBeInTheDocument();
    await fireEvent.click(within(card).getByRole('button', { name: 'Fix login' }));
    expect(store.activeSessionId).toBe('s1');
    expect(followUpsStore.drawerOpen).toBe(false);
  });

  it("names a deleted thread it came from without a link", () => {
    followUpsStore.list = [fu({ fromSessionId: 'gone', fromLabel: 'Old thread' })];
    render(FollowUpsDrawer);
    expect(screen.getByText(/from Old thread/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Old thread' })).not.toBeInTheDocument();
  });

  it('starts a thread from one by filling the New thread draft', async () => {
    const open = vi.spyOn(draftStore, 'openFollowUp').mockReturnValue(true);
    const f = fu();
    followUpsStore.list = [f];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(open).toHaveBeenCalledWith(f);
  });

  it("says so when you're already writing a new thread", async () => {
    vi.spyOn(draftStore, 'openFollowUp').mockReturnValue(false);
    followUpsStore.list = [fu()];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(screen.getByText(/already writing a new thread/)).toBeInTheDocument();
  });

  it("won't start one whose project was removed", async () => {
    const open = vi.spyOn(draftStore, 'openFollowUp');
    followUpsStore.list = [fu({ repoPath: '/removed' })];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/project was removed/)).toBeInTheDocument();
  });

  it('shows the thread started from one, and offers another', () => {
    store.sessions = [{ id: 's2', branch: 'claude/tests', repoPath: '/repo-a', status: 'running', displayName: 'Refresh tests' }];
    followUpsStore.list = [fu({ startedSessionIds: ['s2'] })];
    render(FollowUpsDrawer);
    expect(screen.getByText(/Started in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh tests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start another' })).toBeInTheDocument();
  });

  it('marks one done, and shows what went wrong when it fails', async () => {
    const setDone = vi.spyOn(followUpsStore, 'setDone').mockRejectedValueOnce(new Error("Error invoking remote method 'followUps:setDone': Error: Couldn't read them"));
    followUpsStore.list = [fu()];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(setDone).toHaveBeenCalledWith('a1b2c3', true);
    expect(await screen.findByText("Couldn't read them")).toBeInTheDocument();
  });

  it('deletes one', async () => {
    const remove = vi.spyOn(followUpsStore, 'remove').mockResolvedValue();
    followUpsStore.list = [fu()];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('a1b2c3');
  });

  it('keeps done ones folded away until asked, and can open one again', async () => {
    const setDone = vi.spyOn(followUpsStore, 'setDone').mockResolvedValue();
    followUpsStore.list = [fu({ doneAt: Date.now(), doneNote: 'Added three tests' })];
    render(FollowUpsDrawer);
    expect(screen.getByText('Nothing open.')).toBeInTheDocument();
    expect(screen.queryByText('Added three tests')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show done (1)' }));
    expect(screen.getByText('Added three tests')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(setDone).toHaveBeenCalledWith('a1b2c3', false);
  });

  it('closes on Esc', async () => {
    render(FollowUpsDrawer);
    await fireEvent.keyDown(screen.getByRole('complementary', { name: 'Follow-ups' }), { key: 'Escape' });
    expect(followUpsStore.drawerOpen).toBe(false);
  });
});
