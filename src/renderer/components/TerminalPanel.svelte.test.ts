import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { terminalStore } from '../stores/terminal.svelte.js';
import type { PtySpawnResult } from '../../shared/types.js';

// xterm draws on a canvas jsdom doesn't have; the panel's states are what's tested.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24; options = {};
    loadAddon() {} open() {} onData() {} write() {} clear() {} dispose() {}
    getSelection() { return ''; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

import TerminalPanel from './TerminalPanel.svelte';

const SID = 'terminal-panel';

afterEach(() => {
  cleanup();
  terminalStore.destroySession(SID);
  mockGroveBench.ptySpawn.mockReset();
  mockGroveBench.ptySpawn.mockResolvedValue({ ok: true });
  mockGroveBench.ptyIsAlive.mockReset();
  mockGroveBench.ptyIsAlive.mockResolvedValue(false);
});

describe('TerminalPanel: starting the shell', () => {
  it('says Starting while the shell starts (a new thread waits for its worktree), then Running', async () => {
    let answer: ((r: PtySpawnResult) => void) | undefined;
    mockGroveBench.ptySpawn.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const { getByText, queryByText, getByRole } = render(TerminalPanel, { sessionId: SID });

    await waitFor(() => expect(answer).toBeDefined());
    expect(getByText('Starting…')).toBeInTheDocument();
    expect(queryByText('Stopped')).toBeNull();
    expect(getByRole('button', { name: 'Restart' })).toBeDisabled();

    answer!({ ok: true });
    await waitFor(() => expect(getByText('Running')).toBeInTheDocument());
    expect(getByRole('button', { name: 'Restart' })).toBeEnabled();
  });

  it('says why a start failed, and Try again starts it', async () => {
    mockGroveBench.ptySpawn.mockResolvedValueOnce({ ok: false, error: "This thread has no worktree, so there's nowhere to open the terminal." });
    const { findByText, getByText, getByRole, queryByRole } = render(TerminalPanel, { sessionId: SID });

    expect(await findByText(/Couldn't start the terminal: This thread has no worktree/)).toBeInTheDocument();
    expect(getByText("Couldn't start")).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getByText('Running')).toBeInTheDocument());
    expect(queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(mockGroveBench.ptySpawn).toHaveBeenCalledTimes(2);
  });
});
