import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';

import LinkProjectDialog from './LinkProjectDialog.svelte';
import { store } from '../stores/sessions.svelte.js';
import { linkedStore } from '../stores/linked.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { agentsStore } from '../stores/agents.svelte.js';
import type { GroveBenchAPI } from '../../shared/types.js';

const SID = 'link-dialog-session';
const groveBench = () => (window as any).groveBench as {
  linkProject: Mock<GroveBenchAPI['linkProject']>;
  getLinkedStatus: Mock<GroveBenchAPI['getLinkedStatus']>;
};
let linkedInMain: string[] = [];

beforeEach(() => {
  store.repos = ['/code/app', '/code/billing', '/code/notes', '/code/shared'];
  store.setFolderProject('/code/notes', true);
  store.sessions = [{ id: SID, branch: 'fix-login', repoPath: '/code/app', status: 'running', agentType: 'claude-code', linkedRepos: ['/code/shared'] }];
  agentsStore.list = [
    { id: 'claude-code', displayName: 'Claude Agent', capabilities: { additionalDirectoryInstructions: true }, isDefault: true },
    { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} },
  ];
  agentsStore.loaded = true;
  messageStore.setIsRunning(SID, false);
  linkedStore.openLinkDialog(SID);
  groveBench().linkProject.mockReset();
  groveBench().linkProject.mockImplementation(async (_id, repoPath) => {
    linkedInMain.push(repoPath);
    return { link: { repoPath, path: `/wt/${repoPath}`, branch: 'fix-login' } };
  });
  // Main's links, as the status read after a link reports them.
  linkedInMain = ['/code/shared'];
  groveBench().getLinkedStatus.mockImplementation(async () => linkedInMain.map((repoPath) => ({
    repoPath, path: `/wt/${repoPath}`, branch: 'fix-login', uncommitted: 0, sync: null, base: 'main', unmerged: 0, pr: null,
  })));
});

afterEach(() => {
  cleanup();
  groveBench().getLinkedStatus.mockReset();
  groveBench().getLinkedStatus.mockResolvedValue([]);
  store.setFolderProject('/code/notes', false);
  linkedStore.linkDialogFor = null;
  linkedStore.forget(SID);
  store.sessions = [];
  store.repos = [];
  agentsStore.list = [];
  agentsStore.loaded = false;
});

describe('LinkProjectDialog', () => {
  it('offers the git projects the thread could still work in, and links the one picked', async () => {
    render(LinkProjectDialog, { sessionId: SID });
    const options = screen.getAllByRole('option').map((o) => o.textContent?.trim());
    // Not its own, not a folder project, not one it works in already.
    expect(options).toEqual(['billing']);
    expect(screen.getByTestId('link-restart-note')).toHaveTextContent('The agent restarts on this thread to take the new folder, and keeps the conversation.');

    await fireEvent.click(screen.getByRole('option', { name: 'billing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(groveBench().linkProject).toHaveBeenCalledWith(SID, '/code/billing');
    await waitFor(() => expect(linkedStore.linkDialogFor).toBeNull());
    expect(store.sessions[0].linkedRepos).toEqual(['/code/shared', '/code/billing']);
  });

  it('waits for the turn to end, and says why main refused', async () => {
    messageStore.setIsRunning(SID, true);
    render(LinkProjectDialog, { sessionId: SID });
    await fireEvent.click(screen.getByRole('option', { name: 'billing' }));
    expect(screen.getByTestId('link-mid-turn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();

    messageStore.setIsRunning(SID, false);
    groveBench().linkProject.mockRejectedValueOnce(new Error("Error invoking remote method 'session:linkProject': Error: fix-login is checked out at /code/billing in billing."));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('fix-login is checked out at /code/billing in billing.')).toBeInTheDocument();
    expect(linkedStore.linkDialogFor).toBe(SID);
    expect(store.sessions[0].linkedRepos).toEqual(['/code/shared']);
  });

  it("stays open to say what didn't work, and warns an agent may not edit there", async () => {
    store.sessions = [{ ...store.sessions[0], agentType: 'gemini-cli' }];
    groveBench().linkProject.mockResolvedValueOnce({ link: { repoPath: '/code/billing', path: '/wt/b', branch: 'fix-login' }, warning: 'npm install failed in billing' });
    render(LinkProjectDialog, { sessionId: SID });
    expect(screen.getByText('Gemini CLI is told where the worktree is, but may not be able to edit there.')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('option', { name: 'billing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByTestId('link-warning')).toHaveTextContent('The thread now works in billing, but: npm install failed in billing');
    expect(linkedStore.linkDialogFor).toBe(SID);
  });
});
