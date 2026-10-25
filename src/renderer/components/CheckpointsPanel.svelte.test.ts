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
import { panelStore } from '../stores/panels.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { GitStatusResult } from '../../shared/types.js';

const SID = 'cp-session';

beforeEach(() => {
  vi.clearAllMocks();
  panelStore.collapsed = {};
  checkpointStore.clear(SID);
  reviewStore.clear(SID);
  localStorage.clear();
  messageStore.messagesBySession = { [SID]: [] };
  // The panel under test is on screen.
  store.activeSessionId = SID;
  messageStore.setActiveTab(SID, 'checkpoints');
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
    let resolveFiles: ((v: GitStatusResult) => void) | undefined;
    mockGroveBench.getCheckpointFiles.mockImplementation(() => new Promise((res) => { resolveFiles = res; }));
    const { container, getByText, getByLabelText } = render(CheckpointsPanel, { sessionId: SID });

    await fireEvent.click(getByText('Add polling'));
    await waitFor(() => expect(getByText('Loading diff...')).toBeInTheDocument());
    const sidebar = getByLabelText('Changed files');

    resolveFiles!({ entries: [{ filePath: 'src/a.ts', status: 'modified', staged: false }] });
    await waitFor(() => expect(container.querySelector('[data-file-key="src/a.ts:false"]')).not.toBeNull());
    expect(getByLabelText('Changed files')).toBe(sidebar);
  });

  it('folds the turn list to a rail of turn numbers that still selects turns', async () => {
    mockGroveBench.getCheckpointFiles.mockResolvedValue({ entries: [] });
    const { getByLabelText, getByTitle, queryByText, container } = render(CheckpointsPanel, { sessionId: SID });

    await fireEvent.click(getByLabelText('Collapse checkpoint list'));
    expect(mockGroveBench.setCollapsedPanels).toHaveBeenCalledWith({ checkpointList: true });
    expect(queryByText('Add polling')).toBeNull();

    await fireEvent.click(getByTitle('#1: Initial change'));
    expect(mockGroveBench.getCheckpointFiles).toHaveBeenCalledWith(SID, 'u1', 'turn');
    expect(container.querySelector('[data-turn="1"]')!.className).toContain('border-l-primary');
    // The turn's file list keeps its own flag, so it is still open.
    await waitFor(() => expect(getByLabelText('Collapse file list')).toBeInTheDocument());

    await fireEvent.click(getByLabelText('Expand checkpoint list'));
    expect(queryByText('Add polling')).not.toBeNull();
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

// A rewind discards work that nothing else keeps (the checkpoint is from
// before the turn, and later ones are pruned), so each one asks first.
describe('CheckpointsPanel rewinds', () => {
  const REPLACED = 'your own changes go too, and new files are removed, but the thread keeps a copy of them as they are now, so you can bring them back';
  const THREAD = 'This turn and later ones leave the thread, and the checkpoints after it are deleted.';

  afterEach(() => {
    store.sessions = [];
    agentsStore.list = [];
  });

  async function pick(text: string) {
    const view = render(CheckpointsPanel, { sessionId: SID });
    await fireEvent.click(view.getByText(text));
    return view;
  }

  it('asks before Rewind all, says what it discards, then rewinds files and thread', async () => {
    const { getByRole, queryByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));

    expect(mockGroveBench.rewindSession).not.toHaveBeenCalled();
    expect(getByRole('alert')).toHaveTextContent(`Rewind to #2? Files go back to before this turn: ${REPLACED}. ${THREAD}`);
    await fireEvent.click(getByRole('button', { name: 'Rewind' }));
    await waitFor(() => expect(mockGroveBench.rewindSession).toHaveBeenCalledWith(SID, 'u2', undefined));
    expect(queryByRole('alert')).toBeNull();
  });

  it('shows what a rewind of the files would undo while it asks', async () => {
    const { getByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Thread only' }));
    expect(checkpointStore.getDiffMode(SID)).toBe('turn');

    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));
    expect(checkpointStore.getDiffMode(SID)).toBe('since');
  });

  it('rewinds nothing on Cancel', async () => {
    const { getByRole, queryByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));
    await fireEvent.click(getByRole('button', { name: 'Cancel' }));

    expect(queryByRole('alert')).toBeNull();
    expect(mockGroveBench.rewindSession).not.toHaveBeenCalled();
  });

  it('drops the question when another checkpoint is picked, or its own leaves the list', async () => {
    const { getByRole, getByText, queryByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));
    await fireEvent.click(getByText('Initial change'));
    expect(queryByRole('alert')).toBeNull();

    await fireEvent.click(getByText('Add polling'));
    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));
    // A rewind from the Thread tab pruned it
    checkpointStore.checkpointsBySession = { [SID]: [{ uuid: 'u1', turn: 1, ref: 'r1', text: 'Initial change' }] };
    await waitFor(() => expect(queryByRole('alert')).toBeNull());
  });

  it('says Thread only keeps the files', async () => {
    const { getByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Thread only' }));

    expect(getByRole('alert')).toHaveTextContent(`Rewind the thread to #2? ${THREAD} Files stay as they are.`);
    await fireEvent.click(getByRole('button', { name: 'Rewind thread' }));
    await waitFor(() => expect(mockGroveBench.rewindSession).toHaveBeenCalledWith(SID, 'u2', { conversationOnly: true }));
  });

  it("says when the agent can't forget part of a thread", async () => {
    store.sessions = [{ id: SID, branch: 'b', repoPath: '/repo', status: 'running', agentType: 'gemini-cli' }] as any;
    agentsStore.list = [{ id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: { rewind: false } }] as any;
    const { getByRole } = await pick('Add polling');
    await fireEvent.click(getByRole('button', { name: 'Rewind all' }));

    expect(getByRole('alert')).toHaveTextContent("Gemini CLI can't forget part of a thread, so it starts afresh from there");
  });

  // Main restores only the files of these (rewindFiles), so the tab offers
  // only that, before a /clear or after an earlier rewind took the message.
  it.each([
    ['from before a /clear', { beforeClear: true }],
    ['whose message has left the thread', { inThread: false as const }],
  ])('asks before restoring the files of a checkpoint %s', async (_name, flag) => {
    checkpointStore.checkpointsBySession = {
      [SID]: [{ uuid: 'u1', turn: 1, ref: 'r1', text: 'Initial change', ...flag }],
    };
    const { getByRole, queryByRole } = await pick('Initial change');
    expect(queryByRole('button', { name: 'Rewind all' })).toBeNull();
    expect(queryByRole('button', { name: 'Thread only' })).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Restore files' }));

    expect(getByRole('alert')).toHaveTextContent(`Restore files to #1? They go back to before this turn: ${REPLACED}.`);
    expect(mockGroveBench.rewindSession).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mockGroveBench.rewindSession).toHaveBeenCalledWith(SID, 'u1', { filesOnly: true }));
  });
});
