import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/svelte';
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
  // As the Sidebar renders it: open={memoryStore.panelOpen}
  memoryStore.panelOpen = true;
});

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.repos = [];
  store.activeSessionId = null;
  memoryStore.closeCompactPreview();
  memoryStore.panelOpen = false;
  memoryStore.compactSteps = [];
  memoryStore.compactStepsRepo = null;
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

  it('shows what Compact would run, and runs nothing until Start', async () => {
    mockGroveBench.memoryList.mockResolvedValue([
      { relativePath: 'repo/a.md', title: 'A', updatedAt: '', folder: 'repo' },
    ]);
    mockGroveBench.memoryCompactPreview.mockResolvedValueOnce({
      agentId: 'claude-code', agentName: 'Claude Agent', model: 'claude-haiku-4-5', fileCount: 1, totalBytes: 200,
      maxGroups: 6, parallelMerges: 3, plan: { systemPrompt: 'You are planning A CLEAN-UP', userMessage: 'Plan the clean-up.' },
      planDigest: 'digest-1',
    });
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    const compact = await screen.findByRole('button', { name: 'Compact' });
    await waitFor(() => expect(compact).toBeEnabled());

    await fireEvent.click(compact);

    expect(await screen.findByText('You are planning A CLEAN-UP')).toBeInTheDocument();
    expect(mockGroveBench.memoryCompactPreview).toHaveBeenCalledWith('/repo-a');
    expect(mockGroveBench.memoryCompact).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mockGroveBench.memoryCompact).toHaveBeenCalledWith('/repo-a', { agentId: 'claude-code', planDigest: 'digest-1' }));
  });

  it("lists the last run's model calls and shows each one's prompt", async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(memoryStore.activeRepo).toBe('/repo-a'));
    memoryStore.compactStepsRepo = '/repo-a';
    memoryStore.compactSteps = [{
      index: 1, label: 'Merge 1: repo/a.md, repo/b.md', state: 'rejected', detail: 'repo/a.md changed during the step',
      model: 'claude-haiku-4-5', systemPrompt: 'You are a memory compaction assistant. MERGE PROMPT', userMessage: 'Compact the memory files above.',
      startedAt: 0, startupMs: 1500, durationMs: 31_500, inputBytes: 30 * 1024, outputBytes: 4 * 1024,
    }];

    await fireEvent.click(await screen.findByText(/Last run's model calls/));
    expect(screen.getByText('repo/a.md changed during the step')).toBeInTheDocument();
    expect(screen.getByText('agent up 1.5s · reply 30.0s · 30 KB in · 4 KB out')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show the prompt of Merge 1: repo/a.md, repo/b.md' }));
    expect(await screen.findByText('You are a memory compaction assistant. MERGE PROMPT')).toBeInTheDocument();
  });

  it("hides another project's steps", async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(memoryStore.activeRepo).toBe('/repo-a'));
    memoryStore.compactStepsRepo = '/repo-b';
    memoryStore.compactSteps = [{
      index: 0, label: 'Planning', state: 'done', model: null, systemPrompt: '', userMessage: '', startedAt: 0, inputBytes: 10,
    }];
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/Last run's model calls/)).not.toBeInTheDocument();
  });

  it('follows the open conversation to another project', async () => {
    render(MemoryPanel, { open: true, onclose: vi.fn() });
    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenCalledTimes(1));

    store.activeSessionId = 'b1';

    await waitFor(() => expect(mockGroveBench.memoryList).toHaveBeenLastCalledWith('/repo-b'));
  });
});
