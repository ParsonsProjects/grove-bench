import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';
import type { GroveBenchSettings } from '../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  // Permission & Security
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  disabledSkills: [],
  skillSuggestions: true,

  // Agent Defaults
  defaultModelByAdapter: {},
  defaultThinkingLevel: 'high',
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',

  // Providers
  mistralApiKey: '',

  // Memory
  memoryAutoSave: true,
  memoryAutoCompact: true,

  // Worktree
  autoInstallDeps: false,

  // Sessions
  idleAutoStopMinutes: 30,

  // General
  defaultBaseBranch: '', // empty = auto-detect the repo's default branch
  theme: 'system',
  alwaysOnTop: false,

  // Appearance
  repoColors: {},

  // Editor
  diffViewMode: 'unified',
  spellcheck: true,

  // Notifications
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,

  // Privacy
  analyticsEnabled: false,
  analyticsPrompted: false,
};

let cached: GroveBenchSettings | null = null;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Deep-merge saved data with defaults so new fields are always present. */
function mergeWithDefaults(saved: Partial<GroveBenchSettings>): GroveBenchSettings {
  // Drop the legacy boolean `extendedThinking` (replaced by defaultThinkingLevel)
  // and `devCommand` (the host-managed dev server feature was removed).
  const { extendedThinking: _legacy, devCommand: _devCommand, defaultModel: legacyDefaultModel, ...rest } =
    saved as Partial<GroveBenchSettings> & { extendedThinking?: boolean; devCommand?: string; defaultModel?: string };
  // The global `defaultModel` string predates multi-provider support. It could
  // only ever name a Claude Code model (the sole adapter at the time), so
  // migrate it into the per-adapter map under that id.
  if (legacyDefaultModel && !rest.defaultModelByAdapter?.['claude-code']) {
    rest.defaultModelByAdapter = { ...rest.defaultModelByAdapter, 'claude-code': legacyDefaultModel };
  }
  // 'main' was the old shipped default for defaultBaseBranch; the field is now
  // an explicit override (empty = auto-detect the repo's default branch), so
  // treat the legacy default value as unset. Auto-detect still resolves to
  // main wherever main really is the default branch.
  if (rest.defaultBaseBranch === 'main') rest.defaultBaseBranch = '';
  return { ...DEFAULT_SETTINGS, ...rest };
}

function validate(_s: GroveBenchSettings): void {
  // Placeholder for future validation
}

export function loadSettings(): GroveBenchSettings {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(data) as Partial<GroveBenchSettings>;
    cached = mergeWithDefaults(parsed);
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export function getSettings(): GroveBenchSettings {
  if (!cached) return loadSettings();
  return cached;
}

export function saveSettings(settings: GroveBenchSettings): void {
  validate(settings);
  cached = settings;
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch { /* ignore write errors */ }
}

export function applyImmediateEffects(win: BrowserWindow | null, settings: GroveBenchSettings): void {
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(settings.alwaysOnTop);
  }
  nativeTheme.themeSource = settings.theme;
}
