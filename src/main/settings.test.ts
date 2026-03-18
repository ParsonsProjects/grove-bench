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
    expect(s.theme).toBe('system');
    expect(s.defaultBaseBranch).toBe('main');
    expect(s.alwaysOnTop).toBe(false);
  });

  it('merges saved data with defaults so new fields are present', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      theme: 'dark',
    }));
    const s = loadSettings();
    expect(s.theme).toBe('dark');
    expect(s.defaultPermissionMode).toBe('default');
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

describe('saveSettings', () => {
  it('saves valid settings', () => {
    const s = loadSettings();
    expect(() => saveSettings(s)).not.toThrow();
    expect(mockWriteFileSync).toHaveBeenCalled();
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
