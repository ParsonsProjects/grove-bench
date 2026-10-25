import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';

import { mockGroveBench } from '../__mocks__/setup.js';
import GitOperationNotice from './GitOperationNotice.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';

const SID = 'op-session';
const REBASE = { kind: 'rebase' as const, branch: 'feat', incoming: 'main', step: 1, total: 2 };

beforeEach(() => {
  mockGroveBench.continueGitOperation.mockReset();
  mockGroveBench.continueGitOperation.mockResolvedValue(undefined);
  mockGroveBench.abortGitOperation.mockReset();
  mockGroveBench.abortGitOperation.mockResolvedValue(undefined);
  mockGroveBench.getGitStatus.mockResolvedValue({ entries: [] });
  messageStore.setIsRunning(SID, false);
});

afterEach(() => {
  cleanup();
  gitStatusStore.clear(SID);
  vi.restoreAllMocks();
  messageStore.setIsRunning(SID, false);
});

describe('GitOperationNotice', () => {
  it('says what is under way and holds Continue until the conflicts are resolved', () => {
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Rebasing feat onto main, step 1 of 2. Resolve 1 conflict, then continue.');
    const cont = screen.getByRole('button', { name: 'Continue rebase' });
    expect(cont).toBeDisabled();
    expect(cont).toHaveAttribute('title', 'Mark each conflict resolved first');
  });

  it('continues once they are, and reloads the status, however soon after the last load', async () => {
    // The last file marked resolved just reloaded it.
    await gitStatusStore.refresh(SID);
    mockGroveBench.getGitStatus.mockClear();
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 0 });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue rebase' }));

    expect(mockGroveBench.continueGitOperation).toHaveBeenCalledWith(SID, 'rebase');
    await waitFor(() => expect(mockGroveBench.getGitStatus).toHaveBeenCalled());
  });

  it('asks before aborting, then aborts', async () => {
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(mockGroveBench.abortGitOperation).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Abort the rebase? The branch goes back to how it was before it started, and the conflicts you resolved are lost.');

    await fireEvent.click(screen.getByRole('button', { name: 'Abort rebase' }));
    expect(mockGroveBench.abortGitOperation).toHaveBeenCalledWith(SID, 'rebase');
  });

  it('leaves finishing a merge to the commit box, in Uncommitted', () => {
    const merge = { kind: 'merge' as const, incoming: 'main', branch: 'feat' };
    gitStatusStore.scopeBySession = { [SID]: { scope: 'working' } };
    render(GitOperationNotice, { sessionId: SID, operation: merge, conflicts: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Merging main into feat. All conflicts resolved: commit to finish the merge.');
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeEnabled();
    cleanup();

    // Branch, the tab's first view, has no commit box.
    gitStatusStore.scopeBySession = {};
    render(GitOperationNotice, { sessionId: SID, operation: merge, conflicts: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('All conflicts resolved: commit in Uncommitted to finish the merge.');
  });

  it('between two of several picks, says Continue skips a commit git never started', () => {
    render(GitOperationNotice, { sessionId: SID, operation: { kind: 'cherry-pick', passesOver: '5d1c780' }, conflicts: 0 });
    expect(screen.getByRole('status')).toHaveTextContent("git hasn't picked 5d1c780, and continuing skips it. To pick it, abort and start again.");
    expect(screen.getByRole('button', { name: 'Skip 5d1c780' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeEnabled();
  });

  it("offers no Abort past a commit made by hand, which git wouldn't take back", () => {
    render(GitOperationNotice, { sessionId: SID, operation: { kind: 'cherry-pick', byHand: true }, conflicts: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('git cherry-pick --quit');
    expect(screen.getByRole('button', { name: 'Continue cherry-pick' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Abort' })).toBeNull();
  });

  it('waits while the agent is working: it may be the one running it', () => {
    messageStore.setIsRunning(SID, true);
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 0 });
    expect(screen.getByRole('button', { name: 'Continue rebase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeDisabled();
  });

  it("says why, without Electron's wrapper, when git refuses", async () => {
    mockGroveBench.continueGitOperation.mockRejectedValueOnce(
      new Error("Error invoking remote method 'git:operation-continue': Error: There is no rebase to continue: it may have finished already."),
    );
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 0 });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue rebase' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^There is no rebase to continue: it may have finished already\.$/));
  });

  it('drops an error once git has moved on to another step', async () => {
    mockGroveBench.continueGitOperation.mockRejectedValueOnce(new Error('hook failed'));
    const view = render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 0 });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue rebase' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('hook failed'));

    await view.rerender({ sessionId: SID, operation: { ...REBASE, step: 2 }, conflicts: 1 });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
