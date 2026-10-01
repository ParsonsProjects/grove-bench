import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { settingsStore } from './settings.svelte.js';
import type { GroveBenchSettings } from '../../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  toolAllowRules: [],
  toolDenyRules: [],
  disabledSkills: [],
  autoSkillSuggestions: false,
  defaultModels: {},
  adapterDefaults: {},
  showThinkingSummaries: true,
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  memoryAutoSave: true,
  memoryAutoCompact: false,
  memoryCompactTimeoutSeconds: 300,
  backgroundModels: {},
  autoInstallDeps: false,
  previewAgentTools: true,
  idleSleepMinutes: 30,
  defaultBaseBranch: 'main',
  branchNamingRule: '',
  theme: 'system',
  alwaysOnTop: false,
  repoColors: {},
  groveCharacters: true,
  diffViewMode: 'unified',
  defaultActivityView: 'summary',
  spellcheck: true,
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,
  notifyTaskbarBadge: true,
  analyticsEnabled: false,
  analyticsPrompted: false,
  crashReportsEnabled: false,
};

beforeEach(async () => {
  settingsStore.current = { ...DEFAULT_SETTINGS };
  settingsStore.draft = { ...DEFAULT_SETTINGS };
  // Drop any save a previous test left waiting.
  await settingsStore.save();
  vi.clearAllMocks();
  settingsStore.loading = false;
  settingsStore.loaded = false;
  settingsStore.saving = false;
  settingsStore.savedAt = null;
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

describe('auto-save', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('saves a toggle straight away', async () => {
    settingsStore.draft.alwaysOnTop = true;
    settingsStore.scheduleSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);
    expect((mockGroveBench.saveSettings.mock.calls[0][0] as GroveBenchSettings).alwaysOnTop).toBe(true);
    expect(settingsStore.dirty).toBe(false);
    expect(settingsStore.savedAt).not.toBeNull();
  });

  it('saves typed text after a pause, once', async () => {
    settingsStore.draft.defaultSystemPromptAppend = 'Be';
    settingsStore.scheduleSave();
    await vi.advanceTimersByTimeAsync(300);
    settingsStore.draft.defaultSystemPromptAppend = 'Be brief';
    settingsStore.scheduleSave();
    await vi.advanceTimersByTimeAsync(499);
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);
    expect((mockGroveBench.saveSettings.mock.calls[0][0] as GroveBenchSettings).defaultSystemPromptAppend).toBe('Be brief');
  });

  it('saves waiting text at once when asked, such as when Settings closes', async () => {
    settingsStore.draft.branchNamingRule = 'feat/<ticket>';
    settingsStore.scheduleSave();
    await settingsStore.save();
    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('does nothing when nothing changed', async () => {
    settingsStore.scheduleSave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();
  });

  it('saves an edit made while another save is in flight after it', async () => {
    let finishFirst!: () => void;
    mockGroveBench.saveSettings
      .mockImplementationOnce(() => new Promise<void>((r) => { finishFirst = r; }))
      .mockResolvedValue(undefined);

    settingsStore.draft.spellcheck = false;
    const first = settingsStore.save();
    await Promise.resolve();
    settingsStore.draft.alwaysOnTop = true;
    const second = settingsStore.save();
    finishFirst();
    await Promise.all([first, second]);

    const last = mockGroveBench.saveSettings.mock.calls.at(-1)![0] as GroveBenchSettings;
    expect(last.spellcheck).toBe(false);
    expect(last.alwaysOnTop).toBe(true);
    expect(settingsStore.dirty).toBe(false);
  });

  it('drops an old save error once nothing is left unsaved', async () => {
    settingsStore.loaded = true;
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    await expect(settingsStore.updateNow({ alwaysOnTop: true })).rejects.toThrow('disk full');
    expect(settingsStore.error).toBe('disk full');

    // Try again with nothing to save.
    await settingsStore.save();

    expect(settingsStore.error).toBeNull();
  });

  it('drops the error when the change whose save failed is undone', async () => {
    settingsStore.loaded = true;
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    settingsStore.draft.alwaysOnTop = true;
    await settingsStore.save();
    expect(settingsStore.error).toBe('disk full');

    settingsStore.draft.alwaysOnTop = false;
    settingsStore.scheduleSave();

    expect(settingsStore.error).toBeNull();
  });

  it('waits for a pause before each retry while saves are failing', async () => {
    settingsStore.loaded = true;
    mockGroveBench.saveSettings.mockRejectedValue(new Error('disk full'));
    settingsStore.draft.alwaysOnTop = true;
    await settingsStore.save();
    mockGroveBench.saveSettings.mockClear();

    settingsStore.draft.defaultSystemPromptAppend = 'B';
    settingsStore.scheduleSave();
    settingsStore.draft.defaultSystemPromptAppend = 'Be';
    settingsStore.scheduleSave();
    await vi.advanceTimersByTimeAsync(100);
    expect(mockGroveBench.saveSettings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);
    mockGroveBench.saveSettings.mockResolvedValue(undefined);
  });

  it('keeps the edit and reports the error when a save fails', async () => {
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('Restart Grove Bench and try again.'));
    settingsStore.draft.alwaysOnTop = true;
    await settingsStore.save();

    expect(settingsStore.error).toBe('Restart Grove Bench and try again.');
    expect(settingsStore.draft.alwaysOnTop).toBe(true);
    expect(settingsStore.dirty).toBe(true);
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

  it('saves pending edits before reading, so a reload keeps them', async () => {
    mockGroveBench.saveSettings.mockResolvedValue(undefined);
    mockGroveBench.getSettings.mockImplementation(async () => mockGroveBench.saveSettings.mock.calls.at(-1)?.[0] ?? DEFAULT_SETTINGS);
    settingsStore.draft.alwaysOnTop = true;

    await settingsStore.load();

    expect(mockGroveBench.saveSettings).toHaveBeenCalledTimes(1);
    expect(settingsStore.draft.alwaysOnTop).toBe(true);
    expect(settingsStore.loaded).toBe(true);
  });

  it('keeps an edit whose save fails instead of reloading over it', async () => {
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    mockGroveBench.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    settingsStore.draft.alwaysOnTop = true;

    await settingsStore.load();

    expect(mockGroveBench.getSettings).not.toHaveBeenCalled();
    expect(settingsStore.draft.alwaysOnTop).toBe(true);
    expect(settingsStore.error).toBe('disk full');
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
    settingsStore.draft = { ...settingsStore.draft, theme: 'dark' };

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

  it('skips a rule the list already has', () => {
    settingsStore.addToolAllowRule('shell(npm test)');
    settingsStore.addToolAllowRule('shell(npm test)');
    settingsStore.addToolDenyRule('shell(rm *)');
    settingsStore.addToolDenyRule('shell(rm *)');
    expect(settingsStore.draft.toolAllowRules).toEqual([{ pattern: 'shell(npm test)' }]);
    expect(settingsStore.draft.toolDenyRules).toEqual([{ pattern: 'shell(rm *)' }]);
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
    settingsStore.addWorkingDirectory('/another');
    settingsStore.removeWorkingDirectory(0);
    expect(settingsStore.draft.workingDirectories).toEqual(['/another']);
  });
});



describe('adapter defaults', () => {
  it('sets, reads and clears per-adapter control defaults in the draft', () => {
    expect(settingsStore.adapterDefault('claude-code', 'thinking')).toBeUndefined();
    settingsStore.setAdapterDefault('claude-code', 'thinking', 'low');
    settingsStore.setAdapterDefault('claude-code', 'speed', 'fast');
    settingsStore.setAdapterDefault('codex', 'effort', 'high');
    expect(settingsStore.draft.adapterDefaults).toEqual({
      'claude-code': { thinking: 'low', speed: 'fast' },
      codex: { effort: 'high' },
    });
    expect(settingsStore.adapterDefault('claude-code', 'thinking')).toBe('low');

    // Clearing the last control for an adapter drops the adapter key entirely
    settingsStore.setAdapterDefault('codex', 'effort', null);
    settingsStore.setAdapterDefault('claude-code', 'speed', '');
    expect(settingsStore.draft.adapterDefaults).toEqual({ 'claude-code': { thinking: 'low' } });
    expect(settingsStore.dirty).toBe(true);
  });
});

describe('default models', () => {
  it('keeps one default model per agent and clears it with an empty value', () => {
    expect(settingsStore.defaultModel('claude-code')).toBe('');
    settingsStore.setDefaultModel('claude-code', 'claude-sonnet-4-6');
    settingsStore.setDefaultModel('codex', 'gpt-model');
    expect(settingsStore.draft.defaultModels).toEqual({ 'claude-code': 'claude-sonnet-4-6', codex: 'gpt-model' });
    expect(settingsStore.defaultModel('codex')).toBe('gpt-model');

    settingsStore.setDefaultModel('codex', '');
    expect(settingsStore.draft.defaultModels).toEqual({ 'claude-code': 'claude-sonnet-4-6' });
    expect(settingsStore.dirty).toBe(true);
  });
});

describe('background models', () => {
  it('keeps one background model per agent and clears it with an empty value', () => {
    expect(settingsStore.backgroundModel('claude-code')).toBe('');
    settingsStore.setBackgroundModel('claude-code', 'claude-sonnet-4-6');
    settingsStore.setBackgroundModel('codex', 'codex-mini');
    expect(settingsStore.draft.backgroundModels).toEqual({ 'claude-code': 'claude-sonnet-4-6', codex: 'codex-mini' });

    settingsStore.setBackgroundModel('claude-code', '');
    expect(settingsStore.draft.backgroundModels).toEqual({ codex: 'codex-mini' });
    expect(settingsStore.dirty).toBe(true);
  });
});

describe('updateNow', () => {
  it('keeps both of two quick skill toggles', async () => {
    let finishFirst!: () => void;
    mockGroveBench.saveSettings
      .mockImplementationOnce(() => new Promise<void>((r) => { finishFirst = r; }))
      .mockResolvedValue(undefined);

    const first = settingsStore.setSkillDisabled('lint', true);
    const second = settingsStore.setSkillDisabled('deploy', true);
    await Promise.resolve();
    finishFirst();
    await Promise.all([first, second]);

    expect(settingsStore.current.disabledSkills).toEqual(['lint', 'deploy']);
    const lastSaved = mockGroveBench.saveSettings.mock.calls.at(-1)![0] as GroveBenchSettings;
    expect(lastSaved.disabledSkills).toEqual(['lint', 'deploy']);
  });

  it('keeps going after a failed save', async () => {
    mockGroveBench.saveSettings.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    await expect(settingsStore.updateNow({ theme: 'dark' })).rejects.toThrow('disk full');
    await settingsStore.updateNow({ theme: 'light' });
    expect(settingsStore.current.theme).toBe('light');
  });
});
