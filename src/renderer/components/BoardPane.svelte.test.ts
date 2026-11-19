import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/svelte';

import BoardPane from './BoardPane.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { prStore } from '../stores/pr.svelte.js';
import { groupStore } from '../stores/groups.svelte.js';
import { boardStore } from '../stores/board.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { followUpsStore } from '../stores/followUps.svelte.js';
import { draftStore } from '../stores/draft.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';
import type { FollowUp } from '../../shared/follow-ups.js';

/** The cards in a column, by their thread's id, in order. */
function column(stage: string, lane?: string): string[] {
  const sections = [...document.querySelectorAll<HTMLElement>(`[data-board-column="${stage}"]`)];
  const section = lane ? sections.find((s) => s.getAttribute('aria-label')?.startsWith(`${lane}:`)) : sections[0];
  return [...(section?.querySelectorAll('[data-board-card]') ?? [])].map((c) => c.getAttribute('data-board-card') ?? '');
}

beforeEach(() => {
  store.repos = ['/web', '/api'];
  store.sessions = [
    { id: 'work', branch: 'fix/flaky', repoPath: '/web', status: 'running', displayName: 'Fix flaky test' },
    { id: 'wait', branch: 'electron-34', repoPath: '/web', status: 'running', displayName: 'Upgrade Electron' },
    { id: 'done', branch: 'tabs', repoPath: '/api', status: 'running', displayName: 'Tab loading states' },
    { id: 'quiet', branch: 'hero', repoPath: '/api', status: 'running' },
    { id: 'closed', branch: 'old', repoPath: '/api', status: 'stopped' },
  ] as any;
  store.activeSessionId = null;
  messageStore.isRunning = { work: true };
  messageStore.messagesBySession = {
    wait: [{ kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Bash', toolInput: { command: 'npm install' }, toolUseId: 't1', resolved: false }],
  } as any;
  prStore.prsBySession = {
    done: [{ number: 300, url: 'https://example.test/300', state: 'MERGED' }],
    quiet: [{ number: 301, url: 'https://example.test/301', state: 'OPEN', checks: { total: 2, passed: 1, failed: 1, pending: 0 } }],
  };
  groupStore.groups = [];
  followUpsStore.list = [];
  followUpsStore.ready = true;
  boardStore.lanes = 'none';
  boardStore.query = '';
  boardStore.show();
});

afterEach(() => {
  cleanup();
  boardStore.close();
  boardStore.lanes = 'none';
  boardStore.query = '';
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  messageStore.isRunning = {};
  messageStore.messagesBySession = {};
  prStore.prsBySession = {};
  groupStore.groups = [];
  followUpsStore.list = [];
  draftStore.discard();
});

describe('BoardPane', () => {
  it('puts each open thread in the column its status and pull request say', () => {
    render(BoardPane);
    expect(column('working')).toEqual(['work']);
    expect(column('needs-you')).toEqual(['wait']);
    expect(column('review')).toEqual(['quiet']);
    expect(column('done')).toEqual(['done']);
  });

  it('leaves closed threads off the board', () => {
    render(BoardPane);
    expect(document.querySelector('[data-board-card="closed"]')).toBeNull();
    expect(screen.getByText('4 open threads, 0 follow-ups')).toBeInTheDocument();
  });

  it("shows a card's pull request, and what it is waiting for", () => {
    render(BoardPane);
    const quiet = document.querySelector<HTMLElement>('[data-board-card="quiet"]')!;
    expect(within(quiet).getByText('#301')).toBeInTheDocument();
    expect(within(quiet).getByText('Checks failing')).toBeInTheDocument();
    const done = document.querySelector<HTMLElement>('[data-board-card="done"]')!;
    expect(within(done).getByText('Merged')).toBeInTheDocument();
    const wait = document.querySelector<HTMLElement>('[data-board-card="wait"]')!;
    expect(wait.getAttribute('aria-label')).toContain('Upgrade Electron');
  });

  it("opens a card's thread and closes the board", async () => {
    render(BoardPane);
    await fireEvent.click(document.querySelector('[data-board-card="quiet"]')!);
    expect(store.activeSessionId).toBe('quiet');
    expect(boardStore.open).toBe(false);
  });

  it('says so in an empty column', () => {
    messageStore.isRunning = {};
    render(BoardPane);
    expect(screen.getByText('No agent is working.')).toBeInTheDocument();
  });

  it('splits the board into a lane per project', async () => {
    render(BoardPane);
    await fireEvent.click(screen.getByRole('radio', { name: 'Project' }));
    expect(boardStore.lanes).toBe('project');
    expect([...document.querySelectorAll('[data-board-lane]')].map((l) => l.getAttribute('data-board-lane'))).toEqual(['/web', '/api']);
    expect(column('review', 'api')).toEqual(['quiet']);
    expect(column('working', 'web')).toEqual(['work']);
  });

  it('splits it into a lane per group, ending with the threads in none', () => {
    groupStore.groups = [{ id: 'g1', name: 'Electron upgrade', sessionIds: ['wait', 'done'] }];
    boardStore.lanes = 'group';
    render(BoardPane);
    expect(screen.getByRole('heading', { name: 'Electron upgrade' })).toBeInTheDocument();
    expect(column('needs-you', 'Electron upgrade')).toEqual(['wait']);
    expect(column('working', 'Not in a group')).toEqual(['work']);
  });

  it('filters the cards by name, branch, project or PR number', async () => {
    render(BoardPane);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter cards' }), { target: { value: '#300' } });
    expect(document.querySelectorAll('[data-board-card]')).toHaveLength(1);
    expect(column('done')).toEqual(['done']);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter cards' }), { target: { value: 'nothing like it' } });
    expect(screen.getByText('No cards match "nothing like it".')).toBeInTheDocument();
  });

  it('shows the plain status square when grove characters are off', () => {
    const before = settingsStore.current.groveCharacters;
    settingsStore.current.groveCharacters = false;
    try {
      render(BoardPane);
      const work = document.querySelector<HTMLElement>('[data-board-card="work"]')!;
      expect(work.querySelector('.agent-sprite')).toBeNull();
      expect(within(work).getByRole('img', { name: 'Working' })).toBeInTheDocument();
    } finally {
      settingsStore.current.groveCharacters = before;
    }
  });

  it('says there is nothing to show with no open thread', () => {
    store.sessions = [];
    render(BoardPane);
    expect(screen.getByText('No open threads')).toBeInTheDocument();
  });
});

function fu(id: string, extra: Partial<FollowUp> = {}): FollowUp {
  return { id, repoPath: '/web', title: `Follow-up ${id}`, details: '', createdAt: Date.now() - 60_000, ...extra };
}

describe('BoardPane follow-ups', () => {
  it('shows the open follow-ups first, and not the done ones or those being worked on', () => {
    followUpsStore.list = [
      fu('f1', { details: 'Cover the expired token path.' }),
      fu('f2', { doneAt: Date.now() }),
      fu('f3', { startedSessionIds: ['work'] }),
      fu('f4', { repoPath: '/gone' }),
    ];
    render(BoardPane);
    const cards = [...document.querySelectorAll('[data-board-column="follow-ups"] [data-board-follow-up]')].map((c) => c.getAttribute('data-board-follow-up'));
    expect(cards).toEqual(['f1']);
    expect(screen.getByText('Cover the expired token path.')).toBeInTheDocument();
    expect(screen.getByText('4 open threads, 1 follow-up')).toBeInTheDocument();
  });

  it('brings back one whose thread was closed unfinished, to start again', () => {
    followUpsStore.list = [fu('f1', { startedSessionIds: ['closed'] })];
    render(BoardPane);
    const card = screen.getByRole('article', { name: 'Follow-up: Follow-up f1' });
    expect(within(card).getByText('started before')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Start another' })).toBeInTheDocument();
  });

  it('starts a thread from one: the new thread opens with it, and the board closes', async () => {
    followUpsStore.list = [fu('f1', { details: 'Cover the expired token path.' })];
    render(BoardPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(boardStore.open).toBe(false);
    expect(draftStore.draft?.repoPath).toBe('/web');
    expect(draftStore.draft?.followUpId).toBe('f1');
    expect(draftStore.draft?.text).toContain('Cover the expired token path.');
  });

  it("doesn't take over a new thread you're writing, and says so", async () => {
    followUpsStore.list = [fu('f1')];
    boardStore.close();
    draftStore.open('/web');
    draftStore.setText('My own idea');
    boardStore.show();
    render(BoardPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
    expect(boardStore.open).toBe(true);
    expect(draftStore.draft?.text).toBe('My own idea');
    expect(screen.getByText(/You're already writing a new thread/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(boardStore.open).toBe(false);
  });

  it('marks one done', async () => {
    followUpsStore.list = [fu('f1')];
    render(BoardPane);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mockGroveBench.setFollowUpDone).toHaveBeenCalledWith('f1', true);
  });

  it("opens the New follow-up dialog from the column's +", async () => {
    render(BoardPane);
    await fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }));
    expect(followUpsStore.addingIn).toEqual({ repoPath: '' });
    followUpsStore.closeAdd();
  });

  it('gives a project with only follow-ups its own lane, and filters them by title', async () => {
    store.sessions = store.sessions.filter((s) => s.repoPath === '/web');
    followUpsStore.list = [fu('f1', { repoPath: '/api', title: 'Expire old refresh tokens' })];
    boardStore.lanes = 'project';
    render(BoardPane);
    expect([...document.querySelectorAll('[data-board-lane]')].map((l) => l.getAttribute('data-board-lane'))).toEqual(['/web', '/api']);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter cards' }), { target: { value: 'refresh tokens' } });
    expect(document.querySelectorAll('[data-board-card]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-board-follow-up]')).toHaveLength(1);
  });

  it('shows the board, not the empty screen, when there are only follow-ups', () => {
    store.sessions = [];
    followUpsStore.list = [fu('f1')];
    render(BoardPane);
    expect(screen.queryByText('No open threads')).toBeNull();
    expect(screen.getByRole('article', { name: 'Follow-up: Follow-up f1' })).toBeInTheDocument();
  });
});

describe('BoardPane: a thread started from a follow-up', () => {
  afterEach(() => {
    followUpsStore.toggleDrawer(false);
  });

  it('names the follow-up on its card, and shows it in Follow-ups from there', async () => {
    followUpsStore.list = [fu('f1', { title: 'Cover the expired token path', startedSessionIds: ['work'] })];
    render(BoardPane);
    const link = screen.getByRole('button', { name: /Started from the follow-up Cover the expired token path/ });
    // Its thread's card stands for it, so it isn't in the Follow-ups column.
    expect(document.querySelector('[data-board-follow-up="f1"]')).toBeNull();
    await fireEvent.click(link);
    expect(followUpsStore.drawerOpen).toBe(true);
    expect(followUpsStore.revealId).toBe('f1');
    // Showing the follow-up doesn't open the thread.
    expect(boardStore.open).toBe(true);
    expect(store.activeSessionId).toBeNull();
  });

  it('says when the follow-up is done', () => {
    followUpsStore.list = [fu('f1', { startedSessionIds: ['quiet'], doneAt: Date.now() })];
    render(BoardPane);
    const link = document.querySelector<HTMLElement>('[data-board-card-follow-up="f1"]')!;
    expect(within(link).getByText('done')).toBeInTheDocument();
  });

  it('finds the thread by its follow-up in the filter', async () => {
    followUpsStore.list = [fu('f1', { title: 'Expire old refresh tokens', startedSessionIds: ['quiet'] })];
    render(BoardPane);
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter cards' }), { target: { value: 'refresh tokens' } });
    expect([...document.querySelectorAll('[data-board-card]')].map((c) => c.getAttribute('data-board-card'))).toEqual(['quiet']);
  });
});
