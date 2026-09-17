import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import CheckpointsPanel from './CheckpointsPanel.svelte';
import { checkpointStore } from '../stores/checkpoints.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { reviewStore } from '../stores/review.svelte.js';

const SID = 'cp-session';

beforeEach(() => {
  vi.clearAllMocks();
  checkpointStore.clear(SID);
  reviewStore.clear(SID);
  localStorage.clear();
  messageStore.messagesBySession = { [SID]: [] };
  checkpointStore.checkpointsBySession = {
    [SID]: [
      { uuid: 'u2', turn: 2, ref: 'r2', text: 'Add polling' },
      { uuid: 'u1', turn: 1, ref: 'r1', text: 'Initial change' },
    ],
  };
});

afterEach(() => cleanup());

describe('CheckpointsPanel on the shared review panel', () => {
  it('lists the files of the selected checkpoint and shows their diff', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [{ filePath: 'src/a.ts', status: 'modified', staged: false, contentHash: 'h1', additions: 1, deletions: 1 }] });
    mockGroveBench.getCheckpointFileDiff.mockResolvedValue({ kind: 'text', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n' });

    const { container, getByText } = render(CheckpointsPanel, { sessionId: SID });
    await fireEvent.click(getByText('Add polling'));

    await waitFor(() => expect(container.querySelector('[data-file-key="src/a.ts:false"]')).not.toBeNull());
    expect(mockGroveBench.getCheckpointFiles).toHaveBeenCalledWith(SID, 'u2', 'turn');
    await waitFor(() => expect(container.textContent).toContain('new line'));
    expect(mockGroveBench.getCheckpointFileDiff).toHaveBeenCalledWith(SID, 'u2', 'turn', 'src/a.ts');
    expect(getByText('Changed this turn')).toBeInTheDocument();
    // No git-client actions on a checkpoint comparison.
    expect(container.textContent).not.toContain('Stage');
    expect(container.textContent).not.toContain('Revert');
  });

  it('shows the empty state for a turn without file changes', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [] });
    const { getByText } = render(CheckpointsPanel, { sessionId: SID });
    await fireEvent.click(getByText('Initial change'));
    await waitFor(() => expect(getByText('No file changes in this turn')).toBeInTheDocument());
  });

  it('tags review comments with the checkpoint they were written against', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [{ filePath: 'src/a.ts', status: 'modified', staged: false }] });
    mockGroveBench.getCheckpointFileDiff.mockResolvedValue({ kind: 'text', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n' });
    const { container, getByText, getByPlaceholderText } = render(CheckpointsPanel, { sessionId: SID });
    await fireEvent.click(getByText('Add polling'));
    await waitFor(() => expect(container.textContent).toContain('new line'));

    await fireEvent.click(container.querySelector('button[data-side="new"][aria-label="Add comment on line 1"]')!);
    await fireEvent.input(getByPlaceholderText('What should the agent change here?'), { target: { value: 'Why this?' } });
    await fireEvent.click(getByText('Add comment'));

    const [c] = reviewStore.getComments(SID);
    expect(c.context).toBe('checkpoint #2, this turn');
  });
});
