import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { terminalStore, COMMAND_SETTLED_MS, COMMAND_WINDOW_MS } from './terminal.svelte.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';

const SID = 'term-1';
let output: (data: string) => void;

beforeEach(() => {
  vi.useFakeTimers();
  mockGroveBench.onPtyData.mockImplementation(((_id: string, handler: (data: string) => void) => {
    output = handler;
    return () => {};
  }) as never);
  vi.spyOn(gitStatusStore, 'scheduleRefresh').mockImplementation(() => {});
  sessionStore.sessions = [{ id: SID, branch: 'feat', repoPath: '/repo', status: 'running' }] as never;
  terminalStore.subscribe(SID);
});

afterEach(() => {
  terminalStore.destroySession(SID);
  sessionStore.sessions = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The status reads asked for: each starts the store's wait over. */
const asked = () => vi.mocked(gitStatusStore.scheduleRefresh).mock.calls;

describe('terminalStore: a command typed in the terminal', () => {
  it('asks for the git status a second after Enter, and again with each output until it settles', () => {
    terminalStore.write(SID, 'git rebase main\r');
    output('Successfully rebased');
    output(' and updated refs/heads/feat.\r\n');
    expect(asked()).toEqual([[SID, COMMAND_SETTLED_MS], [SID, COMMAND_SETTLED_MS], [SID, COMMAND_SETTLED_MS]]);
  });

  it('still counts its output a minute on, so a long one is read as it ends', () => {
    terminalStore.write(SID, 'npm install\r');
    vi.advanceTimersByTime(60_000);
    output('added 812 packages\r\n');
    expect(asked()).toHaveLength(2);
  });

  it('asks nothing for keys before Enter, or for output long after it (a server left running)', () => {
    terminalStore.write(SID, 'git sta');
    output('git sta');
    expect(asked()).toHaveLength(0);

    terminalStore.write(SID, 'tus\r');
    vi.advanceTimersByTime(COMMAND_WINDOW_MS);
    output('GET / 200\r\n');
    expect(asked()).toHaveLength(1);
  });

  it('asks nothing in a thread without git', () => {
    sessionStore.sessions = [{ id: SID, branch: '', repoPath: '/notes', status: 'running', noGit: true }] as never;
    terminalStore.write(SID, 'ls\r');
    output('notes.md\r\n');
    expect(asked()).toHaveLength(0);
  });
});
