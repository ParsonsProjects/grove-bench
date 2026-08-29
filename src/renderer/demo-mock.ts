/**
 * Demo harness (screenshots only — served via /demo.html, never bundled into
 * the app). Installs a mock window.groveBench IPC bridge and seeds the stores
 * with representative sessions so the renderer can run in a plain browser.
 */

// Capture uncaught errors (a template error can kill Svelte's effect loop).
const errs: string[] = [];
(window as never as Record<string, unknown>).__demoErrs = errs;
window.addEventListener('error', (e) => {
  errs.push(String((e.error && (e.error as Error).stack) || e.message).slice(0, 800));
});
window.addEventListener('unhandledrejection', (e) => {
  errs.push('rejection: ' + String((e.reason && (e.reason as Error).stack) || e.reason).slice(0, 800));
});

const now = Date.now();
const min = 60_000;

const REPO_A = 'C:/dev/grove-bench';
const REPO_B = 'C:/dev/api-service';

const SETTINGS = {
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  defaultModel: '',
  defaultThinkingLevel: 'high',
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  memoryAutoSave: true,
  autoInstallDeps: false,
  idleAutoStopMinutes: 30,
  defaultBaseBranch: 'main',
  theme: 'dark',
  alwaysOnTop: false,
  repoColors: {},
  diffViewMode: 'unified',
  spellcheck: true,
  analyticsEnabled: false,
  analyticsPrompted: true,
};

const PREVIEWS: Record<string, { firstPrompt: string; lastText: string }> = {
  's-readme': {
    firstPrompt: 'Update the README with the new worktree setup steps and screenshots',
    lastText: 'README updated — added the quick-start section and two screenshots',
  },
  's-perf': {
    firstPrompt: 'Audit the request pipeline for N+1 queries and add caching where it pays off',
    lastText: 'Found 3 N+1 spots; fixed two, the third needs a schema change (see notes)',
  },
};

const GIT_STATUS: Record<string, { entries: { filePath: string; status: string; staged: boolean; additions?: number; deletions?: number }[] }> = {
  's-sidebar': { entries: [
    { filePath: 'src/renderer/components/Sidebar.svelte', status: 'modified', staged: false, additions: 96, deletions: 14 },
    { filePath: 'src/renderer/lib/session-subtitle.ts', status: 'added', staged: false, additions: 88, deletions: 0 },
    { filePath: 'src/shared/types.ts', status: 'modified', staged: false, additions: 27, deletions: 0 },
    { filePath: 'src/main/ipc.ts', status: 'modified', staged: false, additions: 31, deletions: 1 },
  ] },
  's-oauth': { entries: [
    { filePath: 'src/auth/refresh.ts', status: 'modified', staged: false, additions: 12, deletions: 7 },
    { filePath: 'src/auth/refresh.test.ts', status: 'added', staged: false, additions: 41, deletions: 0 },
  ] },
  's-e2e': { entries: [{ filePath: 'e2e/retry-helper.ts', status: 'modified', staged: false, additions: 9, deletions: 4 }] },
};

const CONTENT_HITS = [
  { sessionId: 's-oauth', eventIndex: 14, kind: 'assistant', snippet: '…the OAuth refresh token was being rotated twice per request, which invalidated the second…' },
  { sessionId: 's-oauth', eventIndex: 6, kind: 'user', snippet: 'Fix the OAuth refresh flow — sessions drop after exactly one hour…' },
  { sessionId: 's-perf', eventIndex: 41, kind: 'tool', snippet: 'Grep: pattern "refreshOAuthToken" — 7 matches across src/auth and src/middleware…' },
  { sessionId: 's-readme', eventIndex: 3, kind: 'assistant', snippet: '…documented the OAuth setup env vars in the README configuration table…' },
];

const api: Record<string, unknown> = {
  getSettings: async () => SETTINGS,
  checkPrerequisites: async () => ({
    git: { available: true, version: '2.47.0', meetsMinimum: true },
    agent: { available: true, authenticated: true, authMethod: 'oauth', email: 'demo@example.com' },
  }),
  listRepos: async () => [],
  listSessions: async () => [],
  resumeSession: async (id: string) => ({ id, branch: '' }),
  listWorktrees: async () => [],
  listFiles: async () => [],
  // getActiveTab is restoreApp's last IPC call — seed only after it, so the
  // restore pass can't stop the seeded sessions (it stops "running" sessions
  // it doesn't recognize as open tabs).
  getActiveTab: async () => {
    setTimeout(seedSessions, 150);
    return null;
  },
  listBookmarks: async () => [],
  getOpenTabs: async () => [],
  getCollapsedRepos: async () => ({ [REPO_A]: false, [REPO_B]: false }),
  getSessionSort: async () => ({ key: 'age', dir: 'desc' }),
  getSidebarWidth: async () => 320,
  getEventHistoryPage: async () => ({ events: [], totalCount: 0, startIndex: 0 }),
  getEventHistoryCount: async () => 0,
  searchEventHistory: async () => [],
  searchAllEventHistory: async (_ids: string[], q: string) =>
    q.toLowerCase().includes('oauth') ? CONTENT_HITS : [],
  getSessionPreviews: async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => PREVIEWS[id]).map((id) => [id, PREVIEWS[id]])),
  getGitStatus: async (id: string) => GIT_STATUS[id] ?? { entries: [] },
  getPrInfo: async () => null,
  listCheckpoints: async () => [],
  listMcpServers: async () => [],
  listAdapters: async () => [],
  getModels: async () => [],
  pluginList: async () => ({ installed: [], available: [] }),
  checkForUpdate: async () => null,
  ptyIsAlive: async () => false,
  winIsMaximized: async () => false,
};

(window as unknown as { groveBench: unknown }).groveBench = new Proxy(api, {
  get(target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop in target) return target[prop];
    // Event subscriptions return an unsubscribe fn; everything else resolves quietly.
    if (/^on[A-Z]/.test(prop)) return () => () => {};
    return () => Promise.resolve(undefined);
  },
});

// ─── Phase 1: seed sessions once the app has mounted and restored (empty) state ───
async function seedSessions() {
  const { store } = await import('./stores/sessions.svelte.js');
  (window as never as Record<string, unknown>).__demoStore = store;

  store.addSession({ id: 's-sidebar', branch: 'claude/sidebar-revamp', repoPath: REPO_A, status: 'running', displayName: 'Sidebar revamp', createdAt: now - 52 * min, lastActiveAt: now - 1 * min }, false);
  store.addSession({ id: 's-oauth', branch: 'claude/fix-oauth-refresh', repoPath: REPO_B, status: 'running', createdAt: now - 3 * 60 * min, lastActiveAt: now - 4 * min }, false);
  store.addSession({ id: 's-e2e', branch: 'claude/flaky-e2e-retries', repoPath: REPO_B, status: 'running', displayName: 'Flaky e2e retries', createdAt: now - 26 * 60 * min, lastActiveAt: now - 38 * min }, false);
  store.addSession({ id: 's-readme', branch: 'claude/update-readme', repoPath: REPO_A, status: 'stopped', createdAt: now - 2 * 24 * 60 * min, lastActiveAt: now - 26 * 60 * min }, false);
  store.addSession({ id: 's-perf', branch: 'claude/perf-audit', repoPath: REPO_B, status: 'stopped', createdAt: now - 5 * 24 * 60 * min, lastActiveAt: now - 3 * 24 * 60 * min }, false);
  store.activeSessionId = 's-sidebar';
  // Phase 2 after the panes have mounted and replayed (their onMount clears messages).
  setTimeout(seedConversations, 650);
}

// ─── Phase 2: seed conversations after the panes have mounted and replayed ───
async function seedConversations() {
  const { messageStore } = await import('./stores/messages.svelte.js');

  // Full-object reassignment: key-level mutations on $state<Record> proxies
  // can silently fail to propagate (see the store's own setIsRunning note).
  messageStore.messagesBySession = {
    ...messageStore.messagesBySession,
    // Working: mid-turn, running a test command
    's-sidebar': [
      { kind: 'user', id: 'd1', text: 'Improve the left menu — richer context per agent, search across chats, and more space like the Grok side panel' },
      { kind: 'text', id: 'd2', text: 'I\'ve widened the sidebar and turned each session row into a two-line card: name on top, live context underneath. Running the test suite now to verify the new subtitle logic.', uuid: '' },
      { kind: 'tool_call', id: 'd3', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 'dt1', uuid: '', pending: true },
    ],
    // Waiting: blocked on a Write approval
    's-oauth': [
      { kind: 'user', id: 'd4', text: 'Fix the OAuth refresh flow — sessions drop after exactly one hour' },
      { kind: 'text', id: 'd5', text: 'Found it: the refresh token is rotated twice per request. I need to patch src/auth/refresh.ts to reuse the rotation result.', uuid: '' },
      { kind: 'permission', id: 'd6', requestId: 'dr1', toolName: 'Write', toolInput: { file_path: 'src/auth/refresh.ts' }, toolUseId: 'dt2', resolved: false },
    ],
    // Idle: finished its turn, showing the last answer
    's-e2e': [
      { kind: 'user', id: 'd7', text: 'The checkout e2e suite is flaky on CI — investigate and stabilize' },
      { kind: 'text', id: 'd8', text: 'Done — the retry helper now waits for network idle instead of a fixed 500ms; 40 consecutive green runs on CI.', uuid: '' },
    ],
  } as never;
  messageStore.activityBySession = {
    ...messageStore.activityBySession,
    's-sidebar': { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' },
  };
  messageStore.modelBySession = { ...messageStore.modelBySession, 's-sidebar': 'claude-fable-5' };
  messageStore.setIsRunning('s-sidebar', true);
  messageStore.setIsReady('s-sidebar', true);
  messageStore.setIsRunning('s-oauth', true);
  messageStore.setIsReady('s-oauth', true);
  messageStore.setIsRunning('s-e2e', false);
  messageStore.setIsReady('s-e2e', true);
}

export {};
