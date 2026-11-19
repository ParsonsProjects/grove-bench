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
    expect(screen.getByText('4 open threads')).toBeInTheDocument();
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
