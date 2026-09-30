import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, cleanup, screen } from '@testing-library/svelte';

import WorkspacePane from './WorkspacePane.svelte';
import { messageStore } from '../stores/messages.svelte.js';
import { gitStatusStore } from '../stores/gitStatus.svelte.js';
import { store } from '../stores/sessions.svelte.js';

const SID = 'pane-session';

afterEach(() => {
  cleanup();
  messageStore.destroyAllSessions();
  gitStatusStore.statusBySession = {};
  store.sessions = [];
  store.activeSessionId = null;
});

describe('WorkspacePane tabs', () => {
  it('loads the Changes tab on its first visit', async () => {
    store.sessions = [{ id: SID, branch: 'feat', repoPath: '/repo', status: 'running' }] as never;
    store.activeSessionId = SID;
    gitStatusStore.statusBySession = { [SID]: { entries: [] } };
    messageStore.messagesBySession = { [SID]: [] };
    render(WorkspacePane, { sessionId: SID });
    expect(screen.queryByText('Working tree clean')).toBeNull();

    messageStore.setActiveTab(SID, 'changes');

    expect(await screen.findByText('Working tree clean')).toBeInTheDocument();
  });
});
