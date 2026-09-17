import { vi } from 'vitest';

// ─── localStorage mock ───
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ─── window.groveBench mock ───
const mockGroveBench = {
  onAgentEvent: vi.fn(() => vi.fn()),
  offAgentEvent: vi.fn(),
  respondToPermission: vi.fn().mockResolvedValue(true),
  setMode: vi.fn().mockResolvedValue(undefined),
  getControls: vi.fn().mockResolvedValue({ descriptors: [], values: {} }),
  setControl: vi.fn().mockResolvedValue(undefined),
  setModel: vi.fn().mockResolvedValue(undefined),
  getModels: vi.fn().mockResolvedValue([]),
  getUsage: vi.fn().mockResolvedValue(null),
  setSessionCompleted: vi.fn().mockResolvedValue(undefined),
  listAdapters: vi.fn().mockResolvedValue([]),
  getAdapterControls: vi.fn().mockResolvedValue([]),
  listMcpServers: vi.fn().mockResolvedValue([]),
  reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
  setMcpServerEnabled: vi.fn().mockResolvedValue(undefined),
  authenticateMcpServer: vi.fn().mockResolvedValue({ callbackExpected: false }),
  mcpConfigList: vi.fn().mockResolvedValue([]),
  mcpConfigAdd: vi.fn().mockResolvedValue(undefined),
  mcpConfigRemove: vi.fn().mockResolvedValue(undefined),
  revertFile: vi.fn(),
  stageFile: vi.fn(() => Promise.resolve()),
  unstageFile: vi.fn(() => Promise.resolve()),
  commit: vi.fn(() => Promise.resolve()),
  generateCommitMessage: vi.fn(() => Promise.resolve('feat: mock commit message')),
  push: vi.fn(() => Promise.resolve()),
  getGitSyncStatus: vi.fn(() => Promise.resolve({ upstream: null, ahead: 0, behind: 0 } as import('../../shared/types.js').GitSyncStatus)),
  getBranchCommits: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').BranchCommit[])),
  gitLogCommits: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').CommitEntry[])),
  gitRebase: vi.fn(() => Promise.resolve({ success: true } as import('../../shared/types.js').GitOpResult)),
  gitCherryPick: vi.fn(() => Promise.resolve({ success: true } as import('../../shared/types.js').GitOpResult)),
  gitSquash: vi.fn(() => Promise.resolve({ success: true } as import('../../shared/types.js').GitOpResult)),
  getDefaultBranch: vi.fn(() => Promise.resolve('main')),
  getPrInfo: vi.fn((_sessionId: string) => Promise.resolve(null as import('../../shared/types.js').PrInfo | null)),
  createPr: vi.fn(() => Promise.resolve({ number: 1, url: 'https://example.com/pull/1' } as import('../../shared/types.js').PrInfo)),
  getPrReviewComments: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').PrReviewComment[])),
  rewindSession: vi.fn(() => Promise.resolve()),
  getCheckpointDiff: vi.fn(() => Promise.resolve('')),
  listCheckpoints: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').CheckpointListItem[])),
  getDiffHistory: vi.fn(() => Promise.resolve({ entries: [], total: { filesChanged: 0, additions: 0, deletions: 0 } } as import('../../shared/types.js').DiffHistoryResult)),
  getTurnDiff: vi.fn(() => Promise.resolve('')),
  getFullThreadDiff: vi.fn(() => Promise.resolve('')),
  getCheckpointFiles: vi.fn((_sessionId: string, _uuid: string, _scope: import('../../shared/types.js').CheckpointDiffScope) => Promise.resolve({ entries: [] } as import('../../shared/types.js').GitStatusResult)),
  getCheckpointFileDiff: vi.fn((_sessionId: string, _uuid: string, _scope: import('../../shared/types.js').CheckpointDiffScope, _filePath: string) => Promise.resolve({ kind: 'text', patch: '' } as import('../../shared/types.js').FileDiffResult)),
  getCheckpointFileLines: vi.fn((_sessionId: string, _uuid: string, _scope: import('../../shared/types.js').CheckpointDiffScope, _filePath: string) => Promise.resolve(null as import('../../shared/types.js').FileLinesResult)),
  clearEventHistory: vi.fn(() => Promise.resolve()),
  getEventHistoryPage: vi.fn(() => Promise.resolve({ events: [], totalCount: 0, startIndex: 0 })),
  searchEventHistory: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').EventSearchHit[])),
  searchAllEventHistory: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').CrossSessionSearchHit[])),
  getSessionPreviews: vi.fn(() => Promise.resolve({} as Record<string, import('../../shared/types.js').SessionPreview>)),
  getGitStatus: vi.fn(() => Promise.resolve({ entries: [] } as import('../../shared/types.js').GitStatusResult)),
  getFileDiff: vi.fn((_sessionId: string, _filePath: string, _staged?: boolean) => Promise.resolve({ kind: 'text', patch: '' } as import('../../shared/types.js').FileDiffResult)),
  openInEditor: vi.fn(() => Promise.resolve()),
  getFileLines: vi.fn((_sessionId: string, _filePath: string, _staged?: boolean) => Promise.resolve(null as import('../../shared/types.js').FileLinesResult)),
  sendMessage: vi.fn(),
  notify: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  listSessions: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').SessionInfo[])),
  validateRepo: vi.fn(() => Promise.resolve(true)),
  checkPrerequisites: vi.fn(() => Promise.resolve({ git: { available: true, meetsMinimum: true }, agent: { available: true, authenticated: true } } as import('../../shared/types.js').PrerequisiteStatus)),
  getCachedPrerequisites: vi.fn(() => Promise.resolve(null as import('../../shared/types.js').PrerequisiteStatus | null)),
  checkGhPrerequisite: vi.fn(() => Promise.resolve({ available: false })),
  notifyRestoreComplete: vi.fn(),
  listWorktrees: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').WorktreeInfo[])),
  resumeSession: vi.fn(() => Promise.resolve({ id: '' })),
  listRepos: vi.fn(() => Promise.resolve([] as string[])),
  getCollapsedRepos: vi.fn(() => Promise.resolve({} as Record<string, boolean>)),
  setCollapsedRepos: vi.fn(),
  getSessionSort: vi.fn(() => Promise.resolve({ key: 'age', dir: 'desc' } as import('../../shared/types.js').SessionSortState)),
  setSessionSort: vi.fn(),
  getSidebarWidth: vi.fn(() => Promise.resolve(null as number | null)),
  setSidebarWidth: vi.fn(),
  getUnreadSessions: vi.fn(() => Promise.resolve([] as string[])),
  setUnreadSessions: vi.fn(),
  onAppError: vi.fn(() => () => {}),
  reportError: vi.fn(),
  setAttentionBadge: vi.fn(),
  listBookmarks: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').Bookmark[])),
  addBookmark: vi.fn((b: Omit<import('../../shared/types.js').Bookmark, 'id' | 'createdAt'>) =>
    Promise.resolve({ ...b, id: 'generated-id', createdAt: 0 } as import('../../shared/types.js').Bookmark)),
  removeBookmark: vi.fn(() => Promise.resolve()),
  updateBookmark: vi.fn(() => Promise.resolve()),
  findEventIndexByUuid: vi.fn(() => Promise.resolve(null as number | null)),
  memoryList: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').MemoryEntry[])),
  memoryRead: vi.fn(() => Promise.resolve(null as string | null)),
  memoryWrite: vi.fn(() => Promise.resolve()),
  memoryDelete: vi.fn(() => Promise.resolve(true)),
  memoryCompact: vi.fn(() => Promise.resolve({ compacted: false, filesChanged: [] } as import('../../shared/types.js').MemoryCompactionStatus)),
  memoryCompactCancel: vi.fn(() => Promise.resolve(true)),
  onMemoryCompactEvent: vi.fn(() => () => {}),
  memoryListBackups: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').MemoryBackupInfo[])),
  memoryRestoreBackup: vi.fn(() => Promise.resolve({ restored: false, filesChanged: [] } as import('../../shared/types.js').MemoryRestoreStatus)),
  memoryStats: vi.fn(() => Promise.resolve({
    totalBytes: 0, budgetBytes: 16 * 1024, fileCount: 0, sessionNoteCount: 0,
    skippedFiles: [], lastCompactedAt: null,
  } as import('../../shared/types.js').MemoryStatsResult)),
  memoryBackupPreview: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').MemoryBackupFile[])),
  memoryReadBackupFile: vi.fn(() => Promise.resolve(null as string | null)),
};
// Attach the IPC bridge onto the existing (jsdom) window rather than replacing
// it — replacing window wipes addEventListener/dispatchEvent and breaks any
// component test that mounts a component using window event listeners.
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true });
}
(globalThis.window as unknown as { groveBench: typeof mockGroveBench }).groveBench = mockGroveBench;

export { localStorageMock, mockGroveBench };
