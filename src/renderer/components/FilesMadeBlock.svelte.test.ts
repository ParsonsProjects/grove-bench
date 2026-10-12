import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import { previewStore } from '../stores/preview.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';

import FilesMadeBlock from './FilesMadeBlock.svelte';
import type { MadeFile } from '../../shared/types.js';

const SID = 's1';
const COPY = `${'a'.repeat(32)}.png`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilesMadeBlock', () => {
  it('shows images as thumbnails: the copy taken at the end of the turn, else the file as it is now', () => {
    const files: MadeFile[] = [
      { path: 'shots/home.png', kind: 'image', size: 70, image: { file: COPY } },
      { path: 'chart.svg', kind: 'image', size: 40 },
    ];
    render(FilesMadeBlock, { sessionId: SID, files });

    expect(screen.getByText('Files made')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'shots/home.png' })).toHaveAttribute('src', `grove-attachment://image/${SID}/${COPY}`);
    expect(screen.getByRole('img', { name: 'chart.svg' })).toHaveAttribute('src', `grove-attachment://worktree/${SID}/chart.svg`);
  });

  it('opens other files from the worktree', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValue({ kind: 'opened' });
    render(FilesMadeBlock, { sessionId: SID, files: [{ path: 'out/report.pdf', kind: 'pdf', size: 2048 }] });

    const chip = screen.getByRole('button', { name: /out\/report\.pdf/ });
    expect(chip).toHaveAttribute('title', 'Open out/report.pdf (2 KB)');
    await fireEvent.click(chip);
    expect(mockGroveBench.openWorktreeFile).toHaveBeenCalledWith(SID, 'out/report.pdf');
  });

  it('opens a web page in the Preview tab', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValue({ kind: 'preview', url: 'file:///C:/wt/report/index.html' });
    const navigate = vi.spyOn(previewStore, 'navigate').mockResolvedValue();
    const setTab = vi.spyOn(messageStore, 'setActiveTab');
    render(FilesMadeBlock, { sessionId: SID, files: [{ path: 'report/index.html', kind: 'html', size: 900 }] });

    const chip = screen.getByRole('button', { name: /report\/index\.html/ });
    expect(chip.getAttribute('title')).toContain('in the Preview tab');
    await fireEvent.click(chip);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(SID, 'user', 'file:///C:/wt/report/index.html'));
    expect(setTab).toHaveBeenCalledWith(SID, 'preview');
  });

  it('turns a chip off once its file is gone', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValue({ kind: 'missing' });
    render(FilesMadeBlock, { sessionId: SID, files: [{ path: 'demo.mp4', kind: 'video', size: 10 }] });

    const chip = screen.getByRole('button', { name: /demo\.mp4/ });
    await fireEvent.click(chip);
    await waitFor(() => expect(chip).toBeDisabled());
    expect(chip).toHaveAttribute('title', 'demo.mp4 is no longer in the worktree');
  });

  it('counts the files it left off', () => {
    render(FilesMadeBlock, { sessionId: SID, files: [{ path: 'a.pdf', kind: 'pdf', size: 1 }], more: 5 });
    expect(screen.getByText('and 5 more')).toBeInTheDocument();
  });
});
