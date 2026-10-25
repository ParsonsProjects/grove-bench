import { it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { mockGroveBench } from '../__mocks__/setup.js';
import WorkspacePane from './WorkspacePane.svelte';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';

// The Changes tab's code fails to load (a file the install lost, say). In a
// file of its own, as the mock covers every test in it.
vi.mock('./ChangesReviewPanel.svelte', () => {
  throw new Error('Failed to fetch dynamically imported module: ChangesReviewPanel.js');
});

const SID = 'lazy-1';

afterEach(() => {
  cleanup();
  store.sessions = [];
  store.activeSessionId = null;
  messageStore.destroyAllSessions();
  gitStatusStore.statusBySession = {};
});

it("says the Changes tab couldn't load, in the tab, rather than leaving it blank", async () => {
  store.sessions = [{ id: SID, branch: 'feat', repoPath: '/repo', status: 'running' }] as never;
  store.activeSessionId = SID;
  gitStatusStore.statusBySession = { [SID]: { entries: [] } };
  messageStore.messagesBySession = { [SID]: [] };
  render(WorkspacePane, { sessionId: SID });

  messageStore.setActiveTab(SID, 'changes');

  // (Vitest words the import's error itself.)
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/^Couldn't load the Changes tab: .+\. Retry, or restart Grove Bench if it keeps failing\./);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(mockGroveBench.reportError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'lazy-load', sessionId: SID }));
});
