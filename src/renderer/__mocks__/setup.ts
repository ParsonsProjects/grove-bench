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
  stageFile: vi.fn(() => Promise.resolve()),
  unstageFile: vi.fn(() => Promise.resolve()),
  commit: vi.fn(() => Promise.resolve()),
  rewindSession: vi.fn(() => Promise.resolve()),
  getCheckpointDiff: vi.fn(() => Promise.resolve('')),
  listCheckpoints: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').CheckpointListItem[])),
  clearEventHistory: vi.fn(() => Promise.resolve()),
  getEventHistoryPage: vi.fn(() => Promise.resolve({ events: [], totalCount: 0, startIndex: 0 })),
  searchEventHistory: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').EventSearchHit[])),
  sendMessage: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  listSessions: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').SessionInfo[])),
  validateRepo: vi.fn(() => Promise.resolve(true)),
  listWorktrees: vi.fn(() => Promise.resolve([] as import('../../shared/types.js').WorktreeInfo[])),
  resumeSession: vi.fn(() => Promise.resolve({ id: '' })),
  listRepos: vi.fn(() => Promise.resolve([] as string[])),
};
// Attach the IPC bridge onto the existing (jsdom) window rather than replacing
// it — replacing window wipes addEventListener/dispatchEvent and breaks any
// component test that mounts a component using window event listeners.
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true });
}
(globalThis.window as unknown as { groveBench: typeof mockGroveBench }).groveBench = mockGroveBench;

export { localStorageMock, mockGroveBench };
