import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import GitOpsDialog from './GitOpsDialog.svelte';
import { store } from '../stores/sessions.svelte.js';
import type { CommitEntry } from '../../shared/types.js';

const SID = 'gitops-session';
const commit = (sha: string, subject: string): CommitEntry => ({ sha, shortSha: sha, subject });

beforeEach(() => {
  vi.clearAllMocks();
  store.sessions = [];
});
afterEach(() => cleanup());

async function openCherryPick() {
  render(GitOpsDialog, { sessionId: SID, onclose: () => {}, initialMode: 'cherry-pick' });
  const source = await screen.findByLabelText('Pick from branch') as HTMLInputElement;
  // The last one is the run button; the first is the mode tab.
  const button = () => screen.getAllByRole('button', { name: 'Cherry-pick' }).at(-1)!;
  return { source, button };
}

describe('GitOpsDialog cherry-pick', () => {
  it('disables Cherry-pick once the branch field is cleared', async () => {
    mockGroveBench.gitLogCommits.mockResolvedValue([commit('s1', 'first')]);
    const { source, button } = await openCherryPick();
    await fireEvent.input(source, { target: { value: 'feature' } });
    await screen.findByText('first');
    expect(button()).toBeEnabled();

    await fireEvent.input(source, { target: { value: '' } });

    expect(button()).toBeDisabled();
  });

  it('keeps the list for the latest branch typed when an older reply lands last', async () => {
    let finishOld: ((v: CommitEntry[]) => void) | undefined;
    mockGroveBench.gitLogCommits.mockImplementation(((_sid: string, from: string) =>
      from === 'fe'
        ? new Promise<CommitEntry[]>((res) => { finishOld = res; })
        : Promise.resolve([commit('new1', 'from feature')])) as never);
    const { source } = await openCherryPick();
    await fireEvent.input(source, { target: { value: 'fe' } });
    await fireEvent.input(source, { target: { value: 'feature' } });
    await screen.findByText('from feature');

    finishOld!([commit('old1', 'from fe')]);
    await waitFor(() => expect(screen.queryByText('Loading commits…')).toBeNull());

    expect(screen.queryByText('from fe')).toBeNull();
    expect(screen.getByText('from feature')).toBeInTheDocument();
  });

  it('moves the selection to the next commit after a pick', async () => {
    mockGroveBench.gitLogCommits.mockResolvedValue([commit('s1', 'first'), commit('s2', 'second')]);
    const { source, button } = await openCherryPick();
    await fireEvent.input(source, { target: { value: 'feature' } });
    await screen.findByText('first');

    await fireEvent.click(button());
    await waitFor(() => expect(screen.queryByText('first')).toBeNull());
    await fireEvent.click(button());

    expect(mockGroveBench.gitCherryPick.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['s1', 's2']);
  });
});
