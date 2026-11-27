import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/svelte';

import FollowUpsDrawer from './FollowUpsDrawer.svelte';
import { followUpsStore } from '../stores/followUps.svelte.js';
import { draftStore } from '../stores/draft.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { FollowUp } from '../../shared/follow-ups.js';

// bits-ui scrolls the highlighted option into view; jsdom has no layout.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

function fu(extra: Partial<FollowUp> = {}): FollowUp {
  return { id: 'a1b2c3', repoPath: '/repo-a', title: 'Add tests for refresh', details: 'Cover the expired token path.', createdAt: Date.now(), ...extra };
}

beforeEach(() => {
  followUpsStore.list = [];
  followUpsStore.ready = true;
  followUpsStore.loadFailed = false;
  followUpsStore.notice = null;
  followUpsStore.expanded = new Set();
  followUpsStore.unfolded = new Set();
  followUpsStore.showEnded = new Set();
  followUpsStore.collapsed = new Set();
  followUpsStore.scrollTop = 0;
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
  it('lists open ones highest priority first, and changes one from its card', async () => {
    followUpsStore.list = [
      fu({ id: 'aaaaaa', title: 'Tidy names', priority: 'low' }),
      fu({ id: 'bbbbbb', title: 'Add tests' }),
      fu({ id: 'cccccc', title: 'Fix token check', priority: 'high' }),
    ];
    render(FollowUpsDrawer);
    const titles = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(titles).toEqual(['Fix token check', 'Add tests', 'Tidy names']);

    const trigger = screen.getByRole('button', { name: /Priority of Add tests: Normal/ });
    // jsdom has no pointer capture, so pick from the keyboard.
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'Low' });
    option.focus();
    await fireEvent.pointerMove(option);
    await fireEvent.keyDown(document.activeElement ?? option, { key: 'Enter' });
    await waitFor(() => expect(mockGroveBench.setFollowUpPriority).toHaveBeenCalledWith('bbbbbb', 'low'));
  });

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

  it("says so when you're already writing a new thread, still after moving to another dock", async () => {
    vi.spyOn(draftStore, 'openFollowUp').mockReturnValue(false);
    followUpsStore.list = [fu({ details: 'x'.repeat(300) })];
    const first = render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    // Showing the draft moves the drawer from the thread's dock to the
    // landing's: it mounts again there.
    first.unmount();
    render(FollowUpsDrawer);
    expect(screen.getByText(/already writing a new thread/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it("offers to try again when the list couldn't be read", async () => {
    const load = vi.spyOn(followUpsStore, 'load').mockResolvedValue();
    followUpsStore.ready = false;
    followUpsStore.loadFailed = true;
    render(FollowUpsDrawer);
    expect(screen.queryByText(/Loading follow-ups/)).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn't read your follow-ups/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(load).toHaveBeenCalled();
  });

  it("won't start one whose project was removed", async () => {
    const open = vi.spyOn(draftStore, 'openFollowUp');
    followUpsStore.list = [fu({ repoPath: '/removed' })];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/project was removed/)).toBeInTheDocument();
  });

  it('shows one a thread is working on as two lines, after the ones not started, and in full when its title is clicked', async () => {
    store.sessions = [{ id: 's2', branch: 'claude/tests', repoPath: '/repo-a', status: 'running', displayName: 'Refresh tests' }];
    followUpsStore.list = [
      fu({ startedSessionIds: ['s2'], priority: 'high' }),
      fu({ id: 'dddddd', title: 'Not started', priority: 'low' }),
    ];
    render(FollowUpsDrawer);
    const titles = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(titles).toEqual(['Not started', 'Add tests for refresh, in progress']);
    const small = screen.getByRole('article', { name: 'Add tests for refresh, in progress' });
    expect(within(small).getByText(/In progress in/)).toBeInTheDocument();
    expect(within(small).queryByText('Cover the expired token path.')).not.toBeInTheDocument();
    expect(within(small).queryByRole('button', { name: 'Start another' })).not.toBeInTheDocument();

    await fireEvent.click(within(small).getByRole('button', { name: 'Add tests for refresh' }));
    const full = screen.getByRole('article', { name: 'Add tests for refresh' });
    expect(within(full).getByText('Cover the expired token path.')).toBeInTheDocument();
    expect(within(full).getByText(/Started in/)).toBeInTheDocument();
    expect(within(full).getByRole('button', { name: 'Start another' })).toBeInTheDocument();
    await fireEvent.click(within(full).getByRole('button', { name: 'Show less of Add tests for refresh' }));
    const again = screen.getByRole('article', { name: 'Add tests for refresh, in progress' });

    await fireEvent.click(within(again).getByRole('button', { name: 'Refresh tests' }));
    expect(store.activeSessionId).toBe('s2');
  });

  it('marks done or closes one a thread is working on from its two lines', async () => {
    const setDone = vi.spyOn(followUpsStore, 'setDone').mockResolvedValue();
    const close = vi.spyOn(followUpsStore, 'close').mockResolvedValue();
    store.sessions = [{ id: 's2', branch: 'claude/tests', repoPath: '/repo-a', status: 'running', displayName: 'Refresh tests' }];
    followUpsStore.list = [fu({ startedSessionIds: ['s2'] })];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark Add tests for refresh done' }));
    expect(setDone).toHaveBeenCalledWith('a1b2c3', true);
    await fireEvent.click(screen.getByRole('button', { name: 'Close follow-up Add tests for refresh' }));
    expect(close).toHaveBeenCalledWith('a1b2c3');
  });

  it("shows one whose thread was closed as a whole card, saying it was started before, as the board does", () => {
    followUpsStore.list = [fu({ startedSessionIds: ['gone'] })];
    render(FollowUpsDrawer);
    const card = screen.getByRole('article', { name: 'Add tests for refresh' });
    expect(within(card).getByText(/Started before/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Start another' })).toBeInTheDocument();
  });

  it('says the chevron of a whole in-progress card folds it', async () => {
    store.sessions = [{ id: 's2', branch: 'claude/tests', repoPath: '/repo-a', status: 'running', displayName: 'Refresh tests' }];
    followUpsStore.list = [fu({ startedSessionIds: ['s2'] })];
    render(FollowUpsDrawer);
    expect(screen.getByRole('button', { name: 'Add tests for refresh' })).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(screen.getByRole('button', { name: 'Add tests for refresh' }));
    expect(screen.getByRole('button', { name: 'Show less of Add tests for refresh' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the project one came from, with or without its thread', () => {
    followUpsStore.list = [
      fu({ fromLabel: 'Web work', fromRepoPath: '/repo-b' }),
      fu({ id: 'eeeeee', title: 'No thread name', fromRepoPath: '/repo-b' }),
    ];
    render(FollowUpsDrawer);
    expect(within(screen.getByRole('article', { name: 'Add tests for refresh' })).getByText(/from Web work in repo-b/)).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'No thread name' })).getByText(/from project repo-b/)).toBeInTheDocument();
  });

  it('marks one done, and shows what went wrong when it fails', async () => {
    const setDone = vi.spyOn(followUpsStore, 'setDone').mockRejectedValueOnce(new Error("Error invoking remote method 'followUps:setDone': Error: Couldn't read them"));
    followUpsStore.list = [fu()];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(setDone).toHaveBeenCalledWith('a1b2c3', true);
    expect(await screen.findByText("Couldn't read them")).toBeInTheDocument();
  });

  it('closes one without doing it', async () => {
    const close = vi.spyOn(followUpsStore, 'close').mockResolvedValue();
    followUpsStore.list = [fu()];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Close follow-up Add tests for refresh' }));
    expect(close).toHaveBeenCalledWith('a1b2c3');
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

  it('keeps closed ones with done ones, saying which is which and why one was closed', async () => {
    const setDone = vi.spyOn(followUpsStore, 'setDone').mockResolvedValue();
    store.sessions = [{ id: 's3', branch: 'claude/auth', repoPath: '/repo-a', status: 'stopped', displayName: 'Auth work' }];
    followUpsStore.list = [
      fu({ id: 'aaaaaa', title: 'Finished', doneAt: Date.now() - 1000 }),
      fu({ id: 'bbbbbb', title: 'Dropped', closedAt: Date.now(), closedBySessionId: 's3', closeReason: 'Fixed upstream' }),
    ];
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'Show done and closed (2)' }));
    const closed = screen.getByRole('article', { name: 'Dropped, closed' });
    expect(within(closed).getByText(/Closed/)).toBeInTheDocument();
    expect(within(closed).getByText('Fixed upstream')).toBeInTheDocument();
    expect(within(closed).getByRole('button', { name: 'Auth work' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Finished, done' })).toBeInTheDocument();
    await fireEvent.click(within(closed).getByRole('button', { name: 'Reopen' }));
    expect(setDone).toHaveBeenCalledWith('bbbbbb', false);
    expect(screen.getByRole('button', { name: 'Hide done and closed' })).toBeInTheDocument();
  });

  it('says "closed" when every one of them was closed', () => {
    followUpsStore.list = [fu({ closedAt: Date.now() })];
    render(FollowUpsDrawer);
    expect(screen.getByRole('button', { name: 'Show closed (1)' })).toBeInTheDocument();
  });

  it('folds a project down to its heading, saying how many are in progress', async () => {
    store.sessions = [{ id: 's2', branch: 'claude/tests', repoPath: '/repo-a', status: 'running', displayName: 'Refresh tests' }];
    followUpsStore.list = [
      fu(),
      fu({ id: 'bbbbbb', title: 'Being done', startedSessionIds: ['s2'] }),
      fu({ id: 'cccccc', repoPath: '/repo-b', title: 'Other project' }),
    ];
    render(FollowUpsDrawer);
    const heading = screen.getByRole('button', { name: /repo-a/ });
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(mockGroveBench.setCollapsedFollowUpProjects).toHaveBeenLastCalledWith(['/repo-a']);
    expect(screen.queryByRole('article', { name: 'Add tests for refresh' })).not.toBeInTheDocument();
    expect(within(heading).getByText('1 in progress')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Other project' })).toBeInTheDocument();
    await fireEvent.click(heading);
    expect(screen.getByRole('article', { name: 'Add tests for refresh' })).toBeInTheDocument();
  });

  it('opens where the list was scrolled to when it closed', async () => {
    followUpsStore.list = [fu()];
    const first = render(FollowUpsDrawer);
    const list = first.container.querySelector<HTMLElement>('aside > .overflow-y-auto')!;
    list.scrollTop = 140;
    await fireEvent.scroll(list);
    expect(followUpsStore.scrollTop).toBe(140);
    first.unmount();
    const again = render(FollowUpsDrawer);
    expect(again.container.querySelector<HTMLElement>('aside > .overflow-y-auto')!.scrollTop).toBe(140);
  });

  it('closes on Esc', async () => {
    render(FollowUpsDrawer);
    await fireEvent.keyDown(screen.getByRole('complementary', { name: 'Follow-ups' }), { key: 'Escape' });
    expect(followUpsStore.drawerOpen).toBe(false);
  });
});

describe('FollowUpsDrawer: adding one by hand', () => {
  afterEach(() => {
    followUpsStore.closeAdd();
  });

  it('opens the New follow-up dialog in the project on screen', async () => {
    store.sessions = [{ id: 's1', branch: 'feat', repoPath: '/repo-b', status: 'running' }] as any;
    store.activeSessionId = 's1';
    render(FollowUpsDrawer);
    await fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }));
    expect(followUpsStore.addingIn).toEqual({ repoPath: '/repo-b' });
  });

  it('says how to add one in the empty list', () => {
    render(FollowUpsDrawer);
    expect(screen.getByText(/To add one yourself, click/)).toBeInTheDocument();
  });
});

describe('FollowUpsDrawer: showing one follow-up', () => {
  it('marks the follow-up it was opened to show, done ones included', () => {
    followUpsStore.list = [fu({ id: 'aa0001', title: 'Open one' }), fu({ id: 'aa0002', title: 'Finished one', doneAt: Date.now() })];
    followUpsStore.drawerOpen = false;
    followUpsStore.reveal('aa0002');
    render(FollowUpsDrawer);
    const shown = screen.getByRole('article', { name: 'Finished one, done' });
    expect(shown).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('article', { name: 'Open one' })).not.toHaveAttribute('aria-current');
    followUpsStore.toggleDrawer(false);
  });
});
