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
  onOrchEvent: vi.fn(() => vi.fn()),
  offOrchEvent: vi.fn(),
  respondToPermission: vi.fn(),
  setMode: vi.fn(),
  setThinking: vi.fn(),
  revertFile: vi.fn(),
  sendMessage: vi.fn(),
  listOrchJobs: vi.fn(() => Promise.resolve([])),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
};
Object.defineProperty(globalThis, 'window', {
  value: { groveBench: mockGroveBench },
  writable: true,
});

export { localStorageMock, mockGroveBench };
