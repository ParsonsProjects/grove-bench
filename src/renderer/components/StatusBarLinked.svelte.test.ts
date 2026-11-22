import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';

import StatusBarLinked from './StatusBarLinked.svelte';
import { store } from '../stores/sessions.svelte.js';
import { linkedStore } from '../stores/linked.svelte.js';
import type { GroveBenchAPI, LinkedProjectStatus } from '../../shared/types.js';

const SID = 'linked-bar-session';
const groveBench = () => (window as any).groveBench as {
  getLinkedStatus: Mock<GroveBenchAPI['getLinkedStatus']>;
  openSessionFolder: Mock<GroveBenchAPI['openSessionFolder']>;
  unlinkProject: Mock<GroveBenchAPI['unlinkProject']>;
};

const status = (extra: Partial<LinkedProjectStatus> = {}): LinkedProjectStatus => ({
  repoPath: '/code/billing',
  path: '/wt/hash/linked-bar-session',
  branch: 'fix-login',
  uncommitted: 3,
  sync: { upstream: 'origin/fix-login', ahead: 2, behind: 0 },
  base: 'main',
  unmerged: 4,
  pr: { number: 42, url: 'https://github.com/o/billing/pull/42', state: 'OPEN', title: 'Fix login', headRefName: 'fix-login' },
  ...extra,
});

beforeEach(() => {
  store.repos = ['/code/app', '/code/billing'];
  store.sessions = [{ id: SID, branch: 'fix-login', repoPath: '/code/app', status: 'running', linkedRepos: ['/code/billing'] }];
  groveBench().getLinkedStatus.mockReset();
  groveBench().openSessionFolder.mockClear();
});

afterEach(() => {
  cleanup();
  linkedStore.forget(SID);
  store.sessions = [];
  store.repos = [];
});

describe('StatusBarLinked', () => {
  it("shows each linked project's branch, changes, ahead count and PR, read with PRs", async () => {
    groveBench().getLinkedStatus.mockResolvedValue([status()]);
    render(StatusBarLinked, { sessionId: SID });

    const lozenge = await screen.findByTestId('linked-project');
    expect(groveBench().getLinkedStatus).toHaveBeenCalledWith(SID, { pr: true });
    expect(lozenge.textContent).toContain('billing');
    // The thread's own branch name, shown beside it already.
    expect(lozenge.textContent).not.toContain('fix-login');
    expect(lozenge.textContent).toContain('±3');
    expect(lozenge.textContent).toContain('↑2');
    expect(lozenge.textContent).toContain('#42');

    await fireEvent.click(lozenge);
    expect((await screen.findByTestId('linked-changes')).textContent).toContain('3 files changed and not committed');
    expect(screen.getByText('2 to push')).toBeInTheDocument();
    expect(screen.getByText('4 commits not on main')).toBeInTheDocument();
  });

  it('names the branch when the linked worktree has another one checked out', async () => {
    groveBench().getLinkedStatus.mockResolvedValue([status({ branch: 'hotfix' })]);
    render(StatusBarLinked, { sessionId: SID });
    expect(await screen.findByTestId('linked-branch')).toHaveTextContent('hotfix');
  });

  it("drops a link main doesn't have, once the thread is set up", async () => {
    groveBench().getLinkedStatus.mockResolvedValue([]);
    render(StatusBarLinked, { sessionId: SID });
    await waitFor(() => expect(store.sessions[0].linkedRepos).toBeUndefined());
  });

  it("keeps the links of a thread still being set up, which main hasn't made yet", async () => {
    store.sessions = [{ ...store.sessions[0], status: 'starting' }];
    groveBench().getLinkedStatus.mockResolvedValue([]);
    render(StatusBarLinked, { sessionId: SID });
    await waitFor(() => expect(groveBench().getLinkedStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(store.sessions[0].linkedRepos).toEqual(['/code/billing']);
  });

  it('says when the worktree is gone, and reads nothing for a thread with no links', async () => {
    groveBench().getLinkedStatus.mockResolvedValue([status({ missing: true, branch: null, uncommitted: null, sync: null, pr: null })]);
    render(StatusBarLinked, { sessionId: SID });
    expect((await screen.findByTestId('linked-project')).textContent).toContain('gone');

    cleanup();
    groveBench().getLinkedStatus.mockClear();
    store.sessions = [{ id: SID, branch: 'fix-login', repoPath: '/code/app', status: 'running' }];
    linkedStore.forget(SID);
    render(StatusBarLinked, { sessionId: SID });
    await waitFor(() => expect(screen.queryByTestId('linked-project')).toBeNull());
    expect(groveBench().getLinkedStatus).not.toHaveBeenCalled();
  });
});

describe('StatusBarLinked unlinking', () => {
  it("checks again, warns about uncommitted files and unmerged commits, then unlinks", async () => {
    groveBench().getLinkedStatus.mockResolvedValue([status()]);
    groveBench().unlinkProject.mockClear();
    render(StatusBarLinked, { sessionId: SID });
    await fireEvent.click(await screen.findByTestId('linked-project'));
    await fireEvent.click(screen.getByRole('button', { name: 'Unlink…' }));

    expect(await screen.findByTestId('unlink-uncommitted')).toHaveTextContent('3 files have uncommitted changes there that will be lost.');
    await fireEvent.click(screen.getByLabelText('Also delete the branch in billing, if this thread made it'));
    expect(screen.getByText(/4 commits on fix-login/)).toBeInTheDocument();

    groveBench().getLinkedStatus.mockResolvedValue([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(groveBench().unlinkProject).toHaveBeenCalledWith(SID, '/code/billing', true));
    await waitFor(() => expect(screen.queryByTestId('linked-project')).toBeNull());
    expect(store.sessions[0].linkedRepos).toBeUndefined();
  });

  it("drops a status read that started before an unlink, so the unlinked project doesn't come back", async () => {
    let answerOld!: (v: LinkedProjectStatus[]) => void;
    groveBench().getLinkedStatus.mockResolvedValueOnce([status()]);
    render(StatusBarLinked, { sessionId: SID });
    await screen.findByTestId('linked-project');
    // A poll that is slow to answer, started before the unlink.
    groveBench().getLinkedStatus.mockImplementationOnce(() => new Promise((r) => { answerOld = r; }));
    void linkedStore.refresh(SID);
    groveBench().getLinkedStatus.mockResolvedValue([]);
    await linkedStore.unlink(SID, '/code/billing', false);
    answerOld([status()]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('linked-project')).toBeNull();
  });

  it('keeps the link and says why when main refuses', async () => {
    groveBench().getLinkedStatus.mockResolvedValue([status()]);
    groveBench().unlinkProject.mockRejectedValueOnce(new Error('Unlink the project once the agent finishes this turn.'));
    render(StatusBarLinked, { sessionId: SID });
    await fireEvent.click(await screen.findByTestId('linked-project'));
    await fireEvent.click(screen.getByRole('button', { name: 'Unlink…' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlink' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText('Unlink the project once the agent finishes this turn.')).toBeInTheDocument();
    expect(store.sessions[0].linkedRepos).toEqual(['/code/billing']);
  });
});
