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
  disabledSkills: ['legacy-deploy'] as string[],
  skillSuggestions: true,
  defaultModel: '',
  defaultThinkingLevel: 'high',
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  memoryAutoSave: true,
  memoryAutoCompact: true,
  autoInstallDeps: false,
  idleAutoStopMinutes: 30,
  defaultBaseBranch: '',
  theme: 'dark',
  alwaysOnTop: false,
  repoColors: {},
  diffViewMode: 'unified',
  spellcheck: true,
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,
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
  // Stopped session with uncommitted work — exercises the clean-up dialog's dirty flag
  's-perf': { entries: [
    { filePath: 'src/middleware/cache.ts', status: 'modified', staged: false, additions: 22, deletions: 3 },
    { filePath: 'src/db/query-plan.md', status: 'added', staged: false, additions: 54, deletions: 0 },
  ] },
};

const DEMO_SKILLS = [
  { name: 'code-review', description: 'Review the current diff for correctness bugs and cleanups at a given effort level', source: 'project', path: 'C:/dev/grove-bench/.claude/skills/code-review/SKILL.md' },
  { name: 'deploy-preview', description: 'Build the app and publish a preview channel for this branch', source: 'project', path: 'C:/dev/grove-bench/.claude/skills/deploy-preview/SKILL.md' },
  { name: 'legacy-deploy', description: 'Old NSIS deploy pipeline — superseded by deploy-preview', source: 'project', path: 'C:/dev/grove-bench/.claude/skills/legacy-deploy/SKILL.md' },
  { name: 'release-notes', description: 'Draft release notes from merged PRs since the last tag', source: 'user', path: 'C:/Users/demo/.claude/skills/release-notes/SKILL.md' },
  { name: 'worktree-doctor', description: 'Diagnose and repair broken git worktrees and stale locks', source: 'user', path: 'C:/Users/demo/.claude/skills/worktree-doctor/SKILL.md' },
];

let DEMO_SUGGESTIONS = [
  {
    id: 'a1b2c3',
    name: 'nsis-smoke-test',
    description: 'Use after packaging changes to build the NSIS installer and smoke-test it',
    draftInstructions: 'This command ran in 5 sessions (11 times total):\n\n```\nnpm run dist && start dist/grove-bench-setup.exe /S\n```\n\nDocument when to run it, what to check first, and how to verify the result.',
    rationale: 'Same command run in 5 sessions (11 times)',
    evidence: ['npm run dist && start dist/grove-bench-setup.exe /S'],
    sessionCount: 5,
  },
  {
    id: 'd4e5f6',
    name: 'changelog-update',
    description: 'Use when asked to update the changelog from merged PRs since the last tag',
    draftInstructions: 'Recurring request across 4 sessions. Examples:\n- Update CHANGELOG.md with everything merged since v0.3\n- Add the worktree fixes to the changelog\n\nDocument the proven steps for this task here.',
    rationale: 'Similar requests in 4 sessions (6 prompts)',
    evidence: ['Update CHANGELOG.md with everything merged since v0.3', 'Add the worktree fixes to the changelog'],
    sessionCount: 4,
  },
];

const CONTENT_HITS = [
  { sessionId: 's-oauth', eventIndex: 14, kind: 'assistant', snippet: '…the OAuth refresh token was being rotated twice per request, which invalidated the second…' },
  { sessionId: 's-oauth', eventIndex: 6, kind: 'user', snippet: 'Fix the OAuth refresh flow — sessions drop after exactly one hour…' },
  { sessionId: 's-perf', eventIndex: 41, kind: 'tool', snippet: 'Grep: pattern "refreshOAuthToken" — 7 matches across src/auth and src/middleware…' },
  { sessionId: 's-readme', eventIndex: 3, kind: 'assistant', snippet: '…documented the OAuth setup env vars in the README configuration table…' },
];

// ─── Memory demo data (stateful, so panel actions visibly work) ───

const day = 24 * 60 * min;

function memFile(relativePath: string, title: string, ageMs: number | null, body: string) {
  const updatedAt = ageMs === null ? '' : new Date(now - ageMs).toISOString();
  return {
    relativePath,
    title,
    updatedAt,
    folder: relativePath.split('/').slice(0, -1).join('/') || '.',
    content: `---\ntitle: "${title}"\nupdatedAt: "${updatedAt}"\n---\n\n${body}\n`,
  };
}

let memoryFiles = [
  memFile('repo/overview.md', 'Project Overview', 2 * 60 * min,
    'Electron 33 desktop app orchestrating multiple Claude Code sessions, each in an isolated git worktree with a dedicated PTY terminal.\n\n- UI: Svelte 5 + Tailwind v4 (renderer)\n- Main process: Node, node-pty, execa git wrapper\n- Windows-native (NSIS installer), no cross-platform support in v1'),
  memFile('repo/tech-stack.md', 'Tech Stack', 9 * day,
    'Uses Electron with a Svelte UI. Terminals via xterm.js. Git operations shell out to the git CLI via execa (not simple-git). Tests run on Vitest.'),
  memFile('conventions/naming.md', 'Naming Conventions', 6 * day,
    '- Svelte stores live in `src/renderer/stores/*.svelte.ts` and export a singleton instance\n- IPC channels are namespaced strings, e.g. `memory:list`\n- Main-process modules are flat files under `src/main/`'),
  memFile('architecture/ipc-flow.md', 'IPC Flow', 4 * day,
    'Renderer calls `window.groveBench.*` (exposed by preload contextBridge) → `ipcMain.handle` in `ipc.ts` → main-process module. Events stream back via `webContents.send`.'),
  memFile('sessions/sidebar-revamp.md', 'Session: sidebar-revamp', 60 * min,
    'Widened sidebar, two-line session cards, cross-chat search. Tests green.'),
  memFile('sessions/fix-oauth-refresh.md', 'Session: fix-oauth-refresh', 2 * day,
    'Root cause: refresh token rotated twice per request. Patched refresh.ts to reuse rotation result.'),
  memFile('sessions/perf-audit.md', 'Session: perf-audit', 5 * day,
    'Found 3 N+1 query spots; fixed two, third needs a schema change.'),
  memFile('sessions/update-readme.md', 'Session: update-readme', 45 * day,
    'Added quick-start section and screenshots to README.'),
  memFile('sessions/legacy-migration.md', 'Session: legacy-migration', 120 * day,
    'Migrated settings storage from JSON blobs to per-key files. Obsolete now.'),
  memFile('sessions/spike-notes.md', 'Session: spike notes', null,
    'Scratch notes from an early spike. No timestamp recorded.'),
];

const memoryBackups = [
  { id: '2026-08-29T09-15-02-541Z', createdAt: new Date(now - 7 * 60 * min).toISOString(), fileCount: 4 },
  { id: '2026-08-27T18-40-11-102Z', createdAt: new Date(now - 2 * day).toISOString(), fileCount: 5 },
];

const api: Record<string, unknown> = {
  memoryList: async () => memoryFiles.map(({ content: _c, ...entry }) => entry),
  memoryRead: async (_repo: string, p: string) => memoryFiles.find(f => f.relativePath === p)?.content ?? null,
  memoryWrite: async (_repo: string, p: string, content: string) => {
    const existing = memoryFiles.find(f => f.relativePath === p);
    if (existing) existing.content = content;
    else memoryFiles.push({ ...memFile(p, p.split('/').pop()!.replace('.md', ''), 0, ''), content });
  },
  memoryDelete: async (_repo: string, p: string) => {
    memoryFiles = memoryFiles.filter(f => f.relativePath !== p);
    return true;
  },
  memoryCompact: async () => {
    // Simulate merging the duplicated tech-stack file into the overview
    memoryFiles = memoryFiles.filter(f => f.relativePath !== 'repo/tech-stack.md');
    return {
      compacted: true,
      filesChanged: ['repo/overview.md', 'repo/tech-stack.md'],
      changes: [
        { action: 'update', path: 'repo/overview.md', reason: 'Merged the tech stack details in; dropped the duplicated Electron/Svelte facts' },
        { action: 'delete', path: 'repo/tech-stack.md', reason: 'Fully covered by repo/overview.md after the merge' },
      ],
      backupId: memoryBackups[0].id,
    };
  },
  memoryListBackups: async () => memoryBackups,
  memoryRestoreBackup: async () => ({ restored: true, filesChanged: ['repo/overview.md', 'repo/tech-stack.md'] }),
  memoryStats: async () => {
    const nonSession = memoryFiles.filter(f => !f.folder.startsWith('sessions'));
    const totalBytes = nonSession.reduce((sum, f) => sum + f.content.length, 0) + 11.5 * 1024; // pad to a realistic fill level
    return {
      totalBytes,
      budgetBytes: 16 * 1024,
      fileCount: nonSession.length,
      sessionNoteCount: memoryFiles.length - nonSession.length,
      skippedFiles: [],
      lastCompactedAt: new Date(now - 7 * 60 * min).toISOString(),
      lastAuto: true,
      lastFilesChanged: 2,
    };
  },
  memoryBackupPreview: async (_repo: string, id: string) =>
    memoryFiles
      .filter(f => !f.folder.startsWith('sessions'))
      .map(f => ({ path: f.relativePath, bytes: f.content.length }))
      .concat(id === memoryBackups[1].id ? [{ path: 'repo/tech-stack.md', bytes: 212 }] : []),
  memoryReadBackupFile: async (_repo: string, _id: string, p: string) =>
    memoryFiles.find(f => f.relativePath === p)?.content
      ?? `---\ntitle: "Tech Stack"\n---\n\nArchived copy from before the last compaction.\n`,
  getSettings: async () => SETTINGS,
  saveSettings: async (next: typeof SETTINGS) => {
    Object.assign(SETTINGS, next);
  },
  listSkills: async () => DEMO_SKILLS,
  addSkill: async (_sid: string, _fallback: string, def: { name: string; description: string; scope: string }) => {
    const root = def.scope === 'project' ? 'C:/dev/grove-bench' : 'C:/Users/demo';
    const skill = {
      name: def.name,
      description: def.description,
      source: def.scope,
      path: `${root}/.claude/skills/${def.name}/SKILL.md`,
    };
    DEMO_SKILLS.push(skill);
    return skill;
  },
  getSkillSuggestions: async () => DEMO_SUGGESTIONS,
  analyzeSkillSuggestions: async () => DEMO_SUGGESTIONS,
  dismissSkillSuggestion: async (_repo: string, id: string) => {
    DEMO_SUGGESTIONS = DEMO_SUGGESTIONS.filter((s) => s.id !== id);
  },
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
  getDefaultBranch: async () => 'main',
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
    // Idle: finished its turn with a document-style report (exercises the
    // markdown preview affordance in screenshots)
    's-e2e': [
      { kind: 'user', id: 'd7', text: 'The checkout e2e suite is flaky on CI — investigate and stabilize' },
      { kind: 'text', id: 'd8', text: [
        '## Investigation summary',
        '',
        'The flakiness came from two independent causes, both timing-related:',
        '',
        '| Test | Failure rate | Root cause |',
        '| --- | --- | --- |',
        '| checkout-guest.spec | 18% | fixed 500ms wait races the cart API |',
        '| checkout-saved-card.spec | 7% | stale session cookie between retries |',
        '',
        '## Changes made',
        '',
        '1. Replaced the fixed 500ms wait in `retry-helper.ts` with a network-idle wait',
        '2. Cleared the session cookie jar between retry attempts',
        '3. Added a `flake-report` CI step that uploads per-test retry counts',
        '',
        '## Verification',
        '',
        '40 consecutive green runs on CI, and the flake-report step shows zero retries for both specs.',
      ].join('\n'), uuid: '' },
    ],
  } as never;
  messageStore.activityBySession = {
    ...messageStore.activityBySession,
    's-sidebar': { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' },
  };
  messageStore.modelBySession = { ...messageStore.modelBySession, 's-sidebar': 'claude-fable-5' };
  // System init snapshot for the active session — includes a plugin-provided
  // skill the on-disk scan can't see, so the Skills popover shows all sources.
  messageStore.systemInfoBySession = {
    ...messageStore.systemInfoBySession,
    's-sidebar': {
      tools: ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'WebFetch'],
      agents: ['Explore', 'Plan', 'general-purpose'],
      skills: ['code-review', 'deploy-preview', 'release-notes', 'worktree-doctor', 'changelog-bot'],
      slashCommands: ['compact', 'clear', 'code-review', 'release-notes'],
      mcpServers: [{ name: 'grove-memory', status: 'connected' }],
    },
  };
  messageStore.usageBySession = {
    ...messageStore.usageBySession,
    's-sidebar': { inputTokens: 24_312, outputTokens: 8_120, cacheReadTokens: 210_450, cacheCreationTokens: 12_300 },
  };
  messageStore.contextWindowBySession = { ...messageStore.contextWindowBySession, 's-sidebar': 1_000_000 };
  messageStore.setIsRunning('s-sidebar', true);
  messageStore.setIsReady('s-sidebar', true);
  messageStore.setIsRunning('s-oauth', true);
  messageStore.setIsReady('s-oauth', true);
  messageStore.setIsRunning('s-e2e', false);
  messageStore.setIsReady('s-e2e', true);
}

export {};
