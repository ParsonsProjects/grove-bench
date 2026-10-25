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
  vi.spyOn(gitStatusStore, 'refresh').mockResolvedValue(undefined as never);
  messageStore.setIsRunning(SID, false);
});

afterEach(() => {
  cleanup();
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

  it('continues once they are, and reloads the status', async () => {
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 0 });
    await fireEvent.click(screen.getByRole('button', { name: 'Continue rebase' }));

    expect(mockGroveBench.continueGitOperation).toHaveBeenCalledWith(SID, 'rebase');
    await waitFor(() => expect(gitStatusStore.refresh).toHaveBeenCalledWith(SID));
  });

  it('asks before aborting, then aborts', async () => {
    render(GitOperationNotice, { sessionId: SID, operation: REBASE, conflicts: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(mockGroveBench.abortGitOperation).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Abort the rebase? The branch goes back to how it was before it started, and the conflicts you resolved are lost.');

    await fireEvent.click(screen.getByRole('button', { name: 'Abort rebase' }));
    expect(mockGroveBench.abortGitOperation).toHaveBeenCalledWith(SID, 'rebase');
  });

  it('leaves finishing a merge to the commit box', () => {
    render(GitOperationNotice, { sessionId: SID, operation: { kind: 'merge', incoming: 'main', branch: 'feat' }, conflicts: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Merging main into feat. All conflicts resolved: commit to finish the merge.');
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeEnabled();
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
});
