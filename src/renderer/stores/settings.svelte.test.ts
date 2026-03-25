import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { settingsStore } from './settings.svelte.js';
import type { GroveBenchSettings } from '../../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  defaultModel: '',
  extendedThinking: false,
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  devCommand: '',
  memoryAutoSave: true,
  autoInstallDeps: false,
  defaultBaseBranch: 'main',
  theme: 'system',
  alwaysOnTop: false,
  diffViewMode: 'unified',
  analyticsEnabled: false,
  analyticsPrompted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.current = { ...DEFAULT_SETTINGS };
  settingsStore.draft = { ...DEFAULT_SETTINGS };
  settingsStore.loading = false;
  settingsStore.saving = false;
  settingsStore.error = null;
});

describe('dirty', () => {
  it('is false when draft matches current', () => {
    expect(settingsStore.dirty).toBe(false);
  });

  it('is true when draft differs from current', () => {
    settingsStore.draft = { ...settingsStore.draft, theme: 'dark' };
    expect(settingsStore.dirty).toBe(true);
  });
});

describe('reset', () => {
  it('reverts draft to current', () => {
    settingsStore.draft = { ...settingsStore.draft, theme: 'dark' };
    expect(settingsStore.dirty).toBe(true);

    settingsStore.reset();
    expect(settingsStore.dirty).toBe(false);
    expect(settingsStore.draft.theme).toBe('system');
  });

  it('clears error', () => {
    settingsStore.error = 'some error';
    settingsStore.reset();
    expect(settingsStore.error).toBeNull();
  });
});

describe('load', () => {
  it('loads settings from API', async () => {
    const loaded = { ...DEFAULT_SETTINGS, theme: 'dark' as const };
    mockGroveBench.getSettings.mockResolvedValue(loaded);

    await settingsStore.load();

    expect(settingsStore.current.theme).toBe('dark');
    expect(settingsStore.draft.theme).toBe('dark');
    expect(settingsStore.loading).toBe(false);
  });

  it('sets error on failure', async () => {
    mockGroveBench.getSettings.mockRejectedValue(new Error('IPC failed'));

    await settingsStore.load();

    expect(settingsStore.error).toBe('IPC failed');
    expect(settingsStore.loading).toBe(false);
  });
});

describe('save', () => {
  it('saves draft to API and updates current', async () => {
    mockGroveBench.saveSettings.mockResolvedValue(undefined);
    settingsStore.draft = { ...settingsStore.draft, theme: 'light' };

    await settingsStore.save();

    expect(mockGroveBench.saveSettings).toHaveBeenCalled();
    expect(settingsStore.saving).toBe(false);
    expect(settingsStore.dirty).toBe(false);
  });

  it('sets error on save failure', async () => {
    mockGroveBench.saveSettings.mockRejectedValue(new Error('Validation failed'));

    await settingsStore.save();

    expect(settingsStore.error).toBe('Validation failed');
    expect(settingsStore.saving).toBe(false);
  });
});

describe('tool allow rules', () => {
  it('addToolAllowRule appends a rule', () => {
    settingsStore.addToolAllowRule('Bash(npm run *)');
    expect(settingsStore.draft.toolAllowRules).toHaveLength(1);
    expect(settingsStore.draft.toolAllowRules[0].pattern).toBe('Bash(npm run *)');
  });

  it('removeToolAllowRule removes by index', () => {
    settingsStore.addToolAllowRule('Bash(*)');
    settingsStore.addToolAllowRule('Read(*)');
    settingsStore.removeToolAllowRule(0);
    expect(settingsStore.draft.toolAllowRules).toHaveLength(1);
    expect(settingsStore.draft.toolAllowRules[0].pattern).toBe('Read(*)');
  });

  it('does not mutate current', () => {
    settingsStore.addToolAllowRule('Bash(*)');
    expect(settingsStore.current.toolAllowRules).toHaveLength(0);
  });
});

describe('tool deny rules', () => {
  it('addToolDenyRule appends', () => {
    settingsStore.addToolDenyRule('Bash(rm *)');
    expect(settingsStore.draft.toolDenyRules).toHaveLength(1);
    expect(settingsStore.draft.toolDenyRules[0].pattern).toBe('Bash(rm *)');
  });

  it('removeToolDenyRule removes by index', () => {
    settingsStore.addToolDenyRule('A');
    settingsStore.addToolDenyRule('B');
    settingsStore.removeToolDenyRule(1);
    expect(settingsStore.draft.toolDenyRules).toHaveLength(1);
    expect(settingsStore.draft.toolDenyRules[0].pattern).toBe('A');
  });
});

describe('working directories', () => {
  it('add and remove', () => {
    settingsStore.addWorkingDirectory('/home/user/project');
    expect(settingsStore.draft.workingDirectories).toContain('/home/user/project');

    settingsStore.addWorkingDirectory('/another');
    settingsStore.removeWorkingDirectory(0);
    expect(settingsStore.draft.workingDirectories).toEqual(['/another']);
  });
});


