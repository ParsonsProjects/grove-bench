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

import { loadSettings, saveSettings, getSettings, applyImmediateEffects, upgradeSettings, validateSettings, SETTINGS_SCHEMA_VERSION } from './settings.js';
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
    expect(s.defaultBaseBranch).toBe(''); // empty = auto-detect
    expect(s.alwaysOnTop).toBe(false);
  });

  it('treats the legacy defaultBaseBranch default of "main" as unset', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultBaseBranch: 'main' }));
    const s = loadSettings();
    expect(s.defaultBaseBranch).toBe('');
  });

  it('keeps a non-legacy defaultBaseBranch override', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultBaseBranch: 'develop' }));
    const s = loadSettings();
    expect(s.defaultBaseBranch).toBe('develop');
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

describe('schema versioning', () => {
  it('migrates an unversioned file and stamps the current version on write', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ defaultBaseBranch: 'main', extendedThinking: true, devCommand: 'npm start', theme: 'dark' }));
    const s = loadSettings();
    expect(s.defaultBaseBranch).toBe('');
    expect(s.theme).toBe('dark');
    expect((s as any).extendedThinking).toBeUndefined();
    expect((s as any).devCommand).toBeUndefined();
    // Migrated files are rewritten once so the migration does not rerun
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(written.defaultBaseBranch).toBe('');
  });

  it('does not rewrite or re-migrate a current-version file', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, defaultBaseBranch: 'main' }));
    const s = loadSettings();
    // 'main' is an explicit override once the file is versioned
    expect(s.defaultBaseBranch).toBe('main');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('keeps known fields from a file newer than the app', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { settings, migrated } = upgradeSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION + 5, theme: 'light', futureField: 1 });
    expect(settings.theme).toBe('light');
    expect((settings as any).futureField).toBeUndefined();
    expect(migrated).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('saveSettings stamps the schema version', () => {
    saveSettings(loadSettings());
    const written = JSON.parse(mockWriteFileSync.mock.calls.at(-1)![1] as string);
    expect(Object.keys(written)[0]).toBe('schemaVersion');
    expect(written.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });
});

describe('validateSettings', () => {
  it('falls back per field on invalid values instead of discarding the file', () => {
    const s = validateSettings({
      theme: 'neon',
      defaultThinkingLevel: 'ultra',
      idleAutoStopMinutes: 'soon',
      toolAllowRules: [{ pattern: 'Bash(*)' }],
      toolDenyRules: 'nope',
      repoColors: { '/repo': '#fff' },
      notifyOnPermission: 'yes',
    });
    expect(s.theme).toBe('system');
    expect(s.defaultThinkingLevel).toBe('high');
    expect(s.idleAutoStopMinutes).toBe(30);
    expect(s.toolAllowRules).toEqual([{ pattern: 'Bash(*)' }]);
    expect(s.toolDenyRules).toEqual([]);
    expect(s.repoColors).toEqual({ '/repo': '#fff' });
    expect(s.notifyOnPermission).toBe(true);
  });

  it('drops unknown keys and fills in missing ones', () => {
    const s = validateSettings({ bogus: 1 });
    expect((s as any).bogus).toBeUndefined();
    expect(s.crashReportsEnabled).toBe(false);
    expect(s.notifyTaskbarBadge).toBe(true);
  });

  it('returns defaults for non-object input', () => {
    expect(validateSettings(null).theme).toBe('system');
    expect(validateSettings('x').analyticsEnabled).toBe(false);
  });

  it('saveSettings normalizes what it caches', () => {
    saveSettings({ ...loadSettings(), theme: 'bogus' as any });
    expect(getSettings().theme).toBe('system');
  });
});
