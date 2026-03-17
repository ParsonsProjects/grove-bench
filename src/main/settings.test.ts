import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available when the factory runs
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

import { loadSettings, saveSettings, getSettings, applyImmediateEffects } from './settings.js';
import { nativeTheme } from 'electron';
import type { GroveBenchSettings } from '../shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset cached settings by loading fresh with defaults
  mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });
  loadSettings();
});

describe('loadSettings', () => {
  it('returns defaults when file does not exist', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const s = loadSettings();
    expect(s.defaultPermissionMode).toBe('default');
    expect(s.maxParallelAgents).toBe(5);
    expect(s.circuitBreakerThreshold).toBe(50);
    expect(s.theme).toBe('system');
    expect(s.defaultBaseBranch).toBe('main');
    expect(s.alwaysOnTop).toBe(false);
  });

  it('merges saved data with defaults so new fields are present', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      theme: 'dark',
      maxParallelAgents: 3,
    }));
    const s = loadSettings();
    expect(s.theme).toBe('dark');
    expect(s.maxParallelAgents).toBe(3);
    expect(s.defaultPermissionMode).toBe('default');
    expect(s.circuitBreakerThreshold).toBe(50);
  });

  it('handles corrupt JSON gracefully', () => {
    mockReadFileSync.mockReturnValue('not valid json {{{');
    const s = loadSettings();
    expect(s.defaultPermissionMode).toBe('default');
  });
});

describe('getSettings', () => {
  it('returns cached settings without re-reading file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ theme: 'light' }));
    loadSettings();
    mockReadFileSync.mockClear();

    const s = getSettings();
    expect(s.theme).toBe('light');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});

describe('saveSettings — validate()', () => {
  function makeValid(): GroveBenchSettings {
    return {
      ...loadSettings(),
      defaultTaskTimeoutMinutes: 10,
      maxParallelAgents: 5,
      circuitBreakerThreshold: 50,
      worktreeCleanupIntervalMinutes: 15,
    };
  }

  it('saves valid settings', () => {
    expect(() => saveSettings(makeValid())).not.toThrow();
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('throws when task timeout < 1', () => {
    const s = makeValid();
    s.defaultTaskTimeoutMinutes = 0;
    expect(() => saveSettings(s)).toThrow('Task timeout must be at least 1 minute');
  });

  it('throws when maxParallelAgents < 1', () => {
    const s = makeValid();
    s.maxParallelAgents = 0;
    expect(() => saveSettings(s)).toThrow('Max parallel agents must be at least 1');
  });

  it('throws when circuitBreakerThreshold < 0', () => {
    const s = makeValid();
    s.circuitBreakerThreshold = -1;
    expect(() => saveSettings(s)).toThrow('Circuit breaker threshold must be between 0 and 100');
  });

  it('throws when circuitBreakerThreshold > 100', () => {
    const s = makeValid();
    s.circuitBreakerThreshold = 101;
    expect(() => saveSettings(s)).toThrow('Circuit breaker threshold must be between 0 and 100');
  });

  it('accepts circuitBreakerThreshold at boundaries (0 and 100)', () => {
    const s = makeValid();
    s.circuitBreakerThreshold = 0;
    expect(() => saveSettings(s)).not.toThrow();
    s.circuitBreakerThreshold = 100;
    expect(() => saveSettings(s)).not.toThrow();
  });

  it('throws when worktreeCleanupIntervalMinutes < 1', () => {
    const s = makeValid();
    s.worktreeCleanupIntervalMinutes = 0;
    expect(() => saveSettings(s)).toThrow('Cleanup interval must be at least 1 minute');
  });
});

describe('applyImmediateEffects', () => {
  it('sets alwaysOnTop on the window', () => {
    const win = { isDestroyed: vi.fn(() => false), setAlwaysOnTop: vi.fn() } as any;
    const s = loadSettings();
    s.alwaysOnTop = true;
    applyImmediateEffects(win, s);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it('sets nativeTheme.themeSource', () => {
    const win = { isDestroyed: vi.fn(() => false), setAlwaysOnTop: vi.fn() } as any;
    const s = loadSettings();
    s.theme = 'dark';
    applyImmediateEffects(win, s);
    expect(nativeTheme.themeSource).toBe('dark');
  });

  it('handles null window', () => {
    const s = loadSettings();
    expect(() => applyImmediateEffects(null, s)).not.toThrow();
  });

  it('handles destroyed window', () => {
    const win = { isDestroyed: vi.fn(() => true), setAlwaysOnTop: vi.fn() } as any;
    const s = loadSettings();
    applyImmediateEffects(win, s);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
