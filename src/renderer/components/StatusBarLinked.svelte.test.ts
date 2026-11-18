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
    expect(lozenge.textContent).toContain('fix-login');
    expect(lozenge.textContent).toContain('±3');
    expect(lozenge.textContent).toContain('↑2');
    expect(lozenge.textContent).toContain('#42');

    await fireEvent.click(lozenge);
    expect((await screen.findByTestId('linked-changes')).textContent).toContain('3 files changed and not committed');
    expect(screen.getByText('2 to push')).toBeInTheDocument();
    expect(screen.getByText('4 commits not on main')).toBeInTheDocument();
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
