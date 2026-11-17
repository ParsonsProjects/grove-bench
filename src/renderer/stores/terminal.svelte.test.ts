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

describe('terminalStore: starting the shell', () => {
  it('says Starting while the shell starts, and Running once it has', async () => {
    let answer: ((r: { ok: true }) => void) | undefined;
    mockGroveBench.ptyIsAlive.mockResolvedValueOnce(false);
    mockGroveBench.ptySpawn.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const starting = terminalStore.ensureAlive(SID);
    expect(terminalStore.isStarting(SID)).toBe(true);
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer!({ ok: true });
    await expect(starting).resolves.toBe(true);
    expect(terminalStore.isStarting(SID)).toBe(false);
    expect(terminalStore.isAlive(SID)).toBe(true);
    expect(terminalStore.startError(SID)).toBeNull();
  });

  it('keeps why a start failed, until a start works', async () => {
    mockGroveBench.ptyIsAlive.mockResolvedValueOnce(false);
    mockGroveBench.ptySpawn.mockResolvedValueOnce({ ok: false, error: 'cmd.exe not found' });
    await expect(terminalStore.ensureAlive(SID)).resolves.toBe(false);
    expect(terminalStore.isStarting(SID)).toBe(false);
    expect(terminalStore.isAlive(SID)).toBe(false);
    expect(terminalStore.startError(SID)).toBe('cmd.exe not found');

    mockGroveBench.ptySpawn.mockResolvedValueOnce({ ok: true });
    await expect(terminalStore.restart(SID)).resolves.toBe(true);
    expect(terminalStore.startError(SID)).toBeNull();
  });

  it('reads a failed request as a failed start', async () => {
    mockGroveBench.ptySpawn.mockRejectedValueOnce(new Error("Error invoking remote method 'pty:spawn': Error: boom"));
    await expect(terminalStore.spawn(SID)).resolves.toBe(false);
    expect(terminalStore.startError(SID)).toBe('boom');
  });
});

describe('terminalStore: a start that ends after its thread was deleted', () => {
  it('puts none of its state back', async () => {
    let answer: ((r: { ok: false; error: string }) => void) | undefined;
    mockGroveBench.ptyIsAlive.mockResolvedValueOnce(false);
    mockGroveBench.ptySpawn.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const starting = terminalStore.ensureAlive(SID);
    await vi.waitFor(() => expect(answer).toBeDefined());

    terminalStore.destroySession(SID);
    answer!({ ok: false, error: 'The thread was closed.' });
    await expect(starting).resolves.toBe(false);
    expect(SID in terminalStore.aliveBySession).toBe(false);
    expect(SID in terminalStore.startingBySession).toBe(false);
    expect(SID in terminalStore.startErrorBySession).toBe(false);
  });
});
