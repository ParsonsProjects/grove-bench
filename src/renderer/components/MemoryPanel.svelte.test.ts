import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import MemoryPanel from './MemoryPanel.svelte';
import { memoryStore } from '../stores/memory.svelte.js';
import { store } from '../stores/sessions.svelte.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGroveBench.memoryList.mockResolvedValue([]);
  store.repos = ['/repo-a', '/repo-b'];
  store.sessions = [
    { id: 'a1', branch: 'x', repoPath: '/repo-a', status: 'running' },
    { id: 'b1', branch: 'y', repoPath: '/repo-b', status: 'running' },
  ] as never;
  store.activeSessionId = 'a1';
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
});

describe('MemoryPanel', () => {
  it('opens on the open conversation\'s project', async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenCalledWith('/repo-a'));
    expect(memoryStore.activeRepo).toBe('/repo-a');
  });

  it('keeps an open file when another conversation changes status', async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenCalledTimes(1));
    memoryStore.selectedFile = { path: 'repo/notes.md', content: 'being edited' };

    store.updateStatus('b1', 'sleeping');
    store.updateDisplayName('b1', 'Renamed');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockGroveBench.memoryList).toHaveBeenCalledTimes(1);
    expect(memoryStore.selectedFile?.content).toBe('being edited');
  });

  it('follows the open conversation to another project', async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenCalledTimes(1));

    store.activeSessionId = 'b1';

    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenLastCalledWith('/repo-b'));
  });
});
