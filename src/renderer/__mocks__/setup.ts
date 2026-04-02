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
  setThinking: vi.fn(),
  revertFile: vi.fn(),
  rewindSession: vi.fn(() => Promise.resolve()),
  getCheckpointDiff: vi.fn(() => Promise.resolve('')),
  listCheckpoints: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').CheckpointListItem[])),
  clearEventHistory: vi.fn(() => Promise.resolve()),
  getEventHistoryPage: vi.fn(() => Promise.resolve({ events: [], totalCount: 0, startIndex: 0 })),
  sendMessage: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  listSessions: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').SessionInfo[])),
  validateRepo: vi.fn(() => Promise.resolve(true)),
  listWorktrees: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').WorktreeInfo[])),
  resumeSession: vi.fn(() => Promise.resolve({ id: '' })),
  listRepos: vi.fn(() => Promise.resolve([] as string[])),
  // Terminal (PTY) mocks
  onPtyData: vi.fn(() => vi.fn()),
  onPtyExit: vi.fn(() => vi.fn()),
  ptySpawn: vi.fn(() => Promise.resolve(true)),
  ptyWrite: vi.fn(),
  ptyResize: vi.fn(),
  ptyKill: vi.fn(() => Promise.resolve()),
  ptyIsAlive: vi.fn(() => Promise.resolve(true)),
  // Plugin mocks
  pluginList: vi.fn(() => Promise.resolve({ installed: [], available: [] })),
  pluginInstall: vi.fn(() => Promise.resolve()),
  pluginUninstall: vi.fn(() => Promise.resolve()),
  pluginEnable: vi.fn(() => Promise.resolve()),
  pluginDisable: vi.fn(() => Promise.resolve()),
  // Memory mocks
  memoryList: vi.fn(() => Promise.resolve([])),
  memoryRead: vi.fn(() => Promise.resolve('')),
  memoryWrite: vi.fn(() => Promise.resolve()),
  memoryDelete: vi.fn(() => Promise.resolve()),
  // Git status mock
  getGitStatus: vi.fn(() => Promise.resolve({ entries: [] })),
};
Object.defineProperty(globalThis, 'window', {
  value: { groveBench: mockGroveBench },
  writable: true,
});

export { localStorageMock, mockGroveBench };
