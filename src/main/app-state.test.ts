import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  },
}));

// Fresh module per test to reset internal timers and pending state
let loadAppState: typeof import('./app-state.js')['loadAppState'];
let saveActiveTab: typeof import('./app-state.js')['saveActiveTab'];
let saveOpenTabs: typeof import('./app-state.js')['saveOpenTabs'];
let flushPendingSaves: typeof import('./app-state.js')['flushPendingSaves'];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.resetModules();
  const mod = await import('./app-state.js');
  loadAppState = mod.loadAppState;
  saveActiveTab = mod.saveActiveTab;
  saveOpenTabs = mod.saveOpenTabs;
  flushPendingSaves = mod.flushPendingSaves;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadAppState()', () => {
  it('returns defaults when file does not exist', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const state = loadAppState();
    expect(state).toEqual({ activeTabId: null, openTabIds: [] });
  });

  it('returns parsed state from file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      activeTabId: 'tab-1',
      openTabIds: ['tab-1', 'tab-2'],
    }));
    const state = loadAppState();
    expect(state.activeTabId).toBe('tab-1');
    expect(state.openTabIds).toEqual(['tab-1', 'tab-2']);
  });

  it('returns defaults when file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json');
    const state = loadAppState();
    expect(state).toEqual({ activeTabId: null, openTabIds: [] });
  });
});

describe('saveActiveTab()', () => {
  it('debounces writes by 500ms', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveActiveTab('tab-1');
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.activeTabId).toBe('tab-1');
  });

  it('only writes the last value when called multiple times within debounce window', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveActiveTab('tab-1');
    saveActiveTab('tab-2');
    saveActiveTab('tab-3');

    vi.advanceTimersByTime(500);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.activeTabId).toBe('tab-3');
  });
});

describe('saveOpenTabs()', () => {
  it('debounces writes by 500ms', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveOpenTabs(['a', 'b']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.openTabIds).toEqual(['a', 'b']);
  });
});

describe('flushPendingSaves()', () => {
  it('writes pending active tab immediately', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveActiveTab('tab-flush');
    flushPendingSaves();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.activeTabId).toBe('tab-flush');
  });

  it('writes pending open tabs immediately', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveOpenTabs(['x', 'y']);
    flushPendingSaves();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
    expect(written.openTabIds).toEqual(['x', 'y']);
  });

  it('flushes both active tab and open tabs', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveActiveTab('t1');
    saveOpenTabs(['t1', 't2']);
    flushPendingSaves();
    // Two writes: one for activeTab, one for openTabs
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when nothing is pending', () => {
    flushPendingSaves();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('clears timers so debounced write does not fire again', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ activeTabId: null, openTabIds: [] }));
    saveActiveTab('tab-1');
    flushPendingSaves();
    mockWriteFileSync.mockClear();

    vi.advanceTimersByTime(1000);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
