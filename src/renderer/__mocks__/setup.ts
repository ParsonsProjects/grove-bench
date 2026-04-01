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
};
Object.defineProperty(globalThis, 'window', {
  value: { groveBench: mockGroveBench },
  writable: true,
});

export { localStorageMock, mockGroveBench };
