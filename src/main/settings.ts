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

  // Agent Defaults
  defaultModel: '',
  extendedThinking: false,
  workingDirectories: [],
  defaultSystemPromptAppend: '',

  // Orchestration
  defaultTaskTimeoutMinutes: 10,
  maxParallelAgents: 5,
  circuitBreakerThreshold: 50,
  autoCleanupStaleWorktrees: true,
  worktreeCleanupIntervalMinutes: 15,

  // Docker/Sandbox
  enableDockerByDefault: false,
  sandboxAllowedDomains: [],
  defaultContainerImage: '',
  dockerOAuthToken: '',

  // Dev Server
  devCommand: '',

  // General
  defaultBaseBranch: 'main',
  theme: 'system',
  alwaysOnTop: false,
};

let cached: GroveBenchSettings | null = null;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Deep-merge saved data with defaults so new fields are always present. */
function mergeWithDefaults(saved: Partial<GroveBenchSettings>): GroveBenchSettings {
  return { ...DEFAULT_SETTINGS, ...saved };
}

function validate(s: GroveBenchSettings): void {
  if (s.defaultTaskTimeoutMinutes < 1) throw new Error('Task timeout must be at least 1 minute');
  if (s.maxParallelAgents < 1) throw new Error('Max parallel agents must be at least 1');
  if (s.circuitBreakerThreshold < 0 || s.circuitBreakerThreshold > 100) {
    throw new Error('Circuit breaker threshold must be between 0 and 100');
  }
  if (s.worktreeCleanupIntervalMinutes < 1) throw new Error('Cleanup interval must be at least 1 minute');
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
