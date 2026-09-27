import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';

import BranchPicker from './BranchPicker.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  store.sessions = [
    { id: 's1', branch: 'feat-a', repoPath: '/repo', status: 'running', direct: true },
    { id: 's2', branch: 'feat-a', repoPath: '/repo', status: 'running', direct: true },
    { id: 's3', branch: 'other', repoPath: '/repo', status: 'running' },
  ] as any;
  mockGroveBench.listBranches.mockResolvedValue(['main', 'feat-a', 'feat-b']);
});

afterEach(() => {
  cleanup();
  mockGroveBench.listBranches.mockReset();
  mockGroveBench.switchBranch.mockReset();
  messageStore.isRunning = {};
  store.sessions = [];
});

function renderPicker(props: Partial<{ direct: boolean; onclose: () => void }> = {}) {
  return render(BranchPicker, {
    sessionId: 's1', repoPath: '/repo', currentBranch: 'feat-a', onclose: vi.fn(), ...props,
  });
}

describe('BranchPicker', () => {
  it('shows local branches at once, then refreshes after a fetch', async () => {
    renderPicker();
    await flush();

    expect(mockGroveBench.listBranches).toHaveBeenNthCalledWith(1, '/repo', { fetch: false });
    expect(mockGroveBench.listBranches).toHaveBeenNthCalledWith(2, '/repo');
    expect(screen.getByText('feat-b')).toBeInTheDocument();
  });

  it('switches on click, tells main which conversations are busy, and moves every sharer', async () => {
    const onclose = vi.fn();
    messageStore.isRunning = { s3: true };
    mockGroveBench.switchBranch.mockResolvedValue({ success: true, branch: 'feat-b', sessionIds: ['s1', 's2'] });
    renderPicker({ onclose });
    await flush();

    await fireEvent.click(screen.getByText('feat-b'));
    await flush();

    expect(mockGroveBench.switchBranch).toHaveBeenCalledWith('s1', 'feat-b', { create: false, busySessionIds: ['s3'] });
    expect(store.sessions.map((s) => s.branch)).toEqual(['feat-b', 'feat-b', 'other']);
    expect(onclose).toHaveBeenCalled();
  });

  it('offers to create a typed name and creates it on Enter', async () => {
    mockGroveBench.switchBranch.mockResolvedValue({ success: true, branch: 'feat-new', sessionIds: ['s1'] });
    renderPicker();
    await flush();

    const input = screen.getByPlaceholderText('Switch to a branch, or type a new name');
    await fireEvent.input(input, { target: { value: 'feat-new' } });
    expect(screen.getByText('feat-new')).toBeInTheDocument();
    expect(screen.getByText(/Create branch/)).toBeInTheDocument();

    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    expect(mockGroveBench.switchBranch).toHaveBeenCalledWith('s1', 'feat-new', { create: true, busySessionIds: [] });
  });

  it('keeps the picker open and shows the reason when the switch is refused', async () => {
    const onclose = vi.fn();
    mockGroveBench.switchBranch.mockResolvedValue({ success: false, error: 'This checkout has uncommitted changes. Commit or stash them first.' });
    renderPicker({ onclose });
    await flush();

    await fireEvent.click(screen.getByText('main'));
    await flush();

    expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument();
    expect(onclose).not.toHaveBeenCalled();
    expect(store.sessions[0].branch).toBe('feat-a');
  });

  it('warns that a direct conversation switches the project folder', async () => {
    renderPicker({ direct: true });
    await flush();
    expect(screen.getByText(/runs in your project folder/)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onclose = vi.fn();
    renderPicker({ onclose });
    await flush();

    await fireEvent.keyDown(screen.getByPlaceholderText('Switch to a branch, or type a new name'), { key: 'Escape' });

    expect(onclose).toHaveBeenCalled();
  });
});
