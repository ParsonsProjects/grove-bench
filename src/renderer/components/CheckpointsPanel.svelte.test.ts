import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import CheckpointsPanel from './CheckpointsPanel.svelte';
import { checkpointStore } from '../stores/checkpoints.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { reviewStore } from '../stores/review.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';

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

  it('labels an old checkpoint that stored attached file content with the message text instead', () => {
    checkpointStore.checkpointsBySession = {
      [SID]: [{ uuid: 'u3', turn: 3, ref: 'r3', text: '<file path="a.ts"> const secret = 1; </file>  fix it' }],
    };
    messageStore.messagesBySession = { [SID]: [{ kind: 'user', id: 'm3', text: '[a.ts] fix it', uuid: 'u3' }] };
    const { getByText, queryByText } = render(CheckpointsPanel, { sessionId: SID });
    expect(getByText('[a.ts] fix it')).toBeInTheDocument();
    expect(queryByText(/const secret/)).toBeNull();
  });

  it('shows the empty state for a turn without file changes', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [] });
    const { getByText } = render(CheckpointsPanel, { sessionId: SID });
    await fireEvent.click(getByText('Initial change'));
    await waitFor(() => expect(getByText('No file changes in this turn')).toBeInTheDocument());
  });

  it('keeps the file sidebar for a turn without file changes, so switching turns does not move the layout', async () => {
    mockGroveBench.getCheckpointFiles.mockImplementation(async (_sid: string, uuid: string) =>
      uuid === 'u2' ? { entries: [{ filePath: 'src/a.ts', status: 'modified', staged: false }] } : { entries: [] });
    mockGroveBench.getCheckpointFileDiff.mockResolvedValue({ kind: 'text', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n' });
    const { container, getByText, getByLabelText, queryByText } = render(CheckpointsPanel, { sessionId: SID });

    await fireEvent.click(getByText('Initial change'));
    await waitFor(() => expect(getByText('No file changes in this turn')).toBeInTheDocument());
    const sidebar = getByLabelText('Changed files');
    expect(getByText('0 changes')).toBeInTheDocument();
    expect(sidebar.contains(getByText('No file changes in this turn'))).toBe(false);

    await fireEvent.click(getByText('Add polling'));
    await waitFor(() => expect(container.textContent).toContain('new line'));
    // Same sidebar element: it was not torn down and rebuilt.
    expect(getByLabelText('Changed files')).toBe(sidebar);
    expect(sidebar.querySelector('[data-file-key="src/a.ts:false"]')).not.toBeNull();
    expect(queryByText('No file changes in this turn')).toBeNull();
  });

  it('shows the file sidebar while the first diff loads', async () => {
    let resolveFiles: ((v: { entries: unknown[] }) => void) | undefined;
    mockGroveBench.getCheckpointFiles.mockImplementation(() => new Promise((res) => { resolveFiles = res; }));
    const { container, getByText, getByLabelText } = render(CheckpointsPanel, { sessionId: SID });

    await fireEvent.click(getByText('Add polling'));
    await waitFor(() => expect(getByText('Loading diff...')).toBeInTheDocument());
    const sidebar = getByLabelText('Changed files');

    resolveFiles!({ entries: [{ filePath: 'src/a.ts', status: 'modified', staged: false }] });
    await waitFor(() => expect(container.querySelector('[data-file-key="src/a.ts:false"]')).not.toBeNull());
    expect(getByLabelText('Changed files')).toBe(sidebar);
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

describe('CheckpointsPanel with grove characters', () => {
  beforeEach(() => {
    store.sessions = [{ id: SID, branch: 'feat', repoPath: '/r', status: 'running' }] as any;
  });

  afterEach(() => {
    store.sessions = [];
    settingsStore.current.groveCharacters = true;
  });

  it("puts the conversation's agent on its bench when there are no checkpoints yet", () => {
    checkpointStore.checkpointsBySession = { [SID]: [] };
    const { getByText, getByRole, container } = render(CheckpointsPanel, { sessionId: SID });
    expect(getByText('No checkpoints yet')).toBeInTheDocument();
    expect(getByText(/Each message you send saves one/)).toBeInTheDocument();
    expect(getByRole('img', { name: 'Ready' })).toBeInTheDocument();
    expect(container.querySelector('[data-scenery="flag"]')).not.toBeNull();
  });

  it('puts it next to the list until a checkpoint is picked, and above an empty turn', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [] });
    const { getByText, getByRole } = render(CheckpointsPanel, { sessionId: SID });
    expect(getByText('Select a checkpoint to view changes')).toBeInTheDocument();
    expect(getByRole('img', { name: 'Ready' })).toBeInTheDocument();

    await fireEvent.click(getByText('Initial change'));
    await waitFor(() => expect(getByText('No file changes in this turn')).toBeInTheDocument());
    expect(getByRole('img', { name: 'Ready' })).toBeInTheDocument();
    // The shared diff panel draws the Checkpoints tab's flag, not Changes' can.
    expect(document.querySelector('[data-scenery="flag"]')).not.toBeNull();
    expect(document.querySelector('[data-scenery="watering-can"]')).toBeNull();
  });

  it('shows only the message when grove characters are off', () => {
    settingsStore.current.groveCharacters = false;
    checkpointStore.checkpointsBySession = { [SID]: [] };
    const { getByText, queryByRole } = render(CheckpointsPanel, { sessionId: SID });
    expect(getByText(/No checkpoints yet/)).toBeInTheDocument();
    expect(queryByRole('img', { name: 'Ready' })).toBeNull();
  });
});
