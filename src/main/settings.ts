import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';
import { z } from 'zod';
import type { GroveBenchSettings } from '../shared/types.js';
import { migrateRaw, stampSchemaVersion, type Migration } from './persisted-state.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  // Permission & Security
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  disabledSkills: [],
  autoSkillSuggestions: false,

  // Agent Defaults
  defaultModel: '',
  adapterDefaults: {},
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',

  // Memory
  memoryAutoSave: true,
  memoryAutoCompact: false,
  memoryCompactTimeoutSeconds: 300,
  memoryModel: 'claude-haiku-4-5',

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
  defaultActivityView: 'summary',
  spellcheck: true,

  // Notifications
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,
  notifyTaskbarBadge: true,

  // Privacy
  analyticsEnabled: false,
  analyticsPrompted: false,
  crashReportsEnabled: false,
};

// ─── Schema versioning ───

/** Bump when a saved field changes meaning or shape, and add a migration
 *  below. Adding a new field with a default needs no bump — validation fills
 *  it in. */
export const SETTINGS_SCHEMA_VERSION = 4;

/** `SETTINGS_MIGRATIONS[n]` upgrades a version-n settings object to n+1. */
export const SETTINGS_MIGRATIONS: readonly Migration[] = [
  // 0 → 1: everything written before schema versioning.
  //  - `extendedThinking` (boolean) was replaced by `defaultThinkingLevel`.
  //  - `devCommand` belonged to the removed host-managed dev server feature.
  //  - `skillSuggestions` was renamed to `autoSkillSuggestions` when the
  //    default flipped to off; the old saved `true` was the shipped default,
  //    not an opt-in, so it is not carried over.
  //  - 'main' was the old shipped default for `defaultBaseBranch`; the field is
  //    now an explicit override (empty = auto-detect the repo's default
  //    branch), so the legacy default value means unset. Auto-detect still
  //    resolves to main wherever main really is the default branch.
  (raw) => {
    const { extendedThinking: _legacy, devCommand: _devCommand, skillSuggestions: _skillSuggestions, ...rest } = raw;
    if (rest.defaultBaseBranch === 'main') rest.defaultBaseBranch = '';
    return rest;
  },
  // 1 → 2: `defaultThinkingLevel` (Claude's thinking levels, hand-written)
  // became `adapterDefaults`, keyed by adapter id then control id, so each
  // adapter's own control descriptors drive the Settings UI. The saved level
  // moves under the Claude Code adapter's `thinking` control.
  (raw) => {
    const { defaultThinkingLevel, ...rest } = raw;
    const existing = (typeof rest.adapterDefaults === 'object' && rest.adapterDefaults !== null)
      ? (rest.adapterDefaults as Record<string, Record<string, string>>)
      : {};
    if (typeof defaultThinkingLevel === 'string' && defaultThinkingLevel) {
      rest.adapterDefaults = {
        ...existing,
        'claude-code': { ...(existing['claude-code'] ?? {}), thinking: defaultThinkingLevel },
      };
    } else {
      rest.adapterDefaults = existing;
    }
    return rest;
  },
  // 2 → 3: the app-level "auto-accept edits + read-only commands" mode was
  // renamed from 'auto' to 'readSafe' so that 'auto' can mean the provider's
  // native auto mode (Claude Code's classifier). A saved 'auto' predates the
  // native mode, so it keeps its old meaning.
  (raw) => {
    if (raw.defaultPermissionMode === 'auto') raw.defaultPermissionMode = 'readSafe';
    return raw;
  },
  // 3 → 4: Claude's thinking budgets gave way to the Effort control. On
  // adaptive-thinking models Claude Code ignored the Low/Medium/High budgets,
  // and those models now offer Thinking as On/Off only, so a saved budget
  // default is dropped. 'off' and 'adaptive' keep their meaning.
  (raw) => {
    const defaults = raw.adapterDefaults as Record<string, Record<string, string>> | undefined;
    const claude = defaults?.['claude-code'];
    if (claude && ['low', 'medium', 'high'].includes(claude.thinking)) {
      const { thinking: _budget, ...rest } = claude;
      raw.adapterDefaults = { ...defaults, 'claude-code': rest };
    }
    return raw;
  },
];

// ─── Validation ───

const toolRuleSchema = z.object({ pattern: z.string() });
const hexColor = z.string();

/** Field-level validation: an invalid value falls back to its default rather
 *  than rejecting the whole file (`.catch`). Unknown keys are dropped. */
const settingsSchema = z.object({
  defaultPermissionMode: z.enum(['default', 'plan', 'acceptEdits', 'readSafe', 'auto', 'bypassPermissions']).catch(DEFAULT_SETTINGS.defaultPermissionMode),
  toolAllowRules: z.array(toolRuleSchema).catch(DEFAULT_SETTINGS.toolAllowRules),
  toolDenyRules: z.array(toolRuleSchema).catch(DEFAULT_SETTINGS.toolDenyRules),
  disableBypassMode: z.boolean().catch(DEFAULT_SETTINGS.disableBypassMode),
  disabledSkills: z.array(z.string()).catch(DEFAULT_SETTINGS.disabledSkills),
  autoSkillSuggestions: z.boolean().catch(DEFAULT_SETTINGS.autoSkillSuggestions),

  defaultModel: z.string().catch(DEFAULT_SETTINGS.defaultModel),
  adapterDefaults: z.record(z.string(), z.record(z.string(), z.string())).catch(DEFAULT_SETTINGS.adapterDefaults),
  cavemanMode: z.enum(['off', 'lite', 'full', 'ultra']).catch(DEFAULT_SETTINGS.cavemanMode),
  workingDirectories: z.array(z.string()).catch(DEFAULT_SETTINGS.workingDirectories),
  defaultSystemPromptAppend: z.string().catch(DEFAULT_SETTINGS.defaultSystemPromptAppend),

  memoryAutoSave: z.boolean().catch(DEFAULT_SETTINGS.memoryAutoSave),
  memoryAutoCompact: z.boolean().catch(DEFAULT_SETTINGS.memoryAutoCompact),
  memoryCompactTimeoutSeconds: z.number().finite().nonnegative().catch(DEFAULT_SETTINGS.memoryCompactTimeoutSeconds),
  memoryModel: z.string().catch(DEFAULT_SETTINGS.memoryModel),

  autoInstallDeps: z.boolean().catch(DEFAULT_SETTINGS.autoInstallDeps),

  idleAutoStopMinutes: z.number().finite().nonnegative().catch(DEFAULT_SETTINGS.idleAutoStopMinutes),

  defaultBaseBranch: z.string().catch(DEFAULT_SETTINGS.defaultBaseBranch),
  theme: z.enum(['system', 'dark', 'light']).catch(DEFAULT_SETTINGS.theme),
  alwaysOnTop: z.boolean().catch(DEFAULT_SETTINGS.alwaysOnTop),

  repoColors: z.record(z.string(), hexColor).catch(DEFAULT_SETTINGS.repoColors),

  diffViewMode: z.enum(['unified', 'side-by-side']).catch(DEFAULT_SETTINGS.diffViewMode),
  defaultActivityView: z.enum(['detailed', 'summary', 'focus']).catch(DEFAULT_SETTINGS.defaultActivityView),
  spellcheck: z.boolean().catch(DEFAULT_SETTINGS.spellcheck),

  notifyOnTurnComplete: z.boolean().catch(DEFAULT_SETTINGS.notifyOnTurnComplete),
  notifyOnPermission: z.boolean().catch(DEFAULT_SETTINGS.notifyOnPermission),
  notifyOnPrAlert: z.boolean().catch(DEFAULT_SETTINGS.notifyOnPrAlert),
  notifyTaskbarFlash: z.boolean().catch(DEFAULT_SETTINGS.notifyTaskbarFlash),
  notifyTaskbarBadge: z.boolean().catch(DEFAULT_SETTINGS.notifyTaskbarBadge),

  analyticsEnabled: z.boolean().catch(DEFAULT_SETTINGS.analyticsEnabled),
  analyticsPrompted: z.boolean().catch(DEFAULT_SETTINGS.analyticsPrompted),
  crashReportsEnabled: z.boolean().catch(DEFAULT_SETTINGS.crashReportsEnabled),
}) satisfies z.ZodType<GroveBenchSettings, unknown>;

/**
 * Normalize an arbitrary object into a complete, valid settings object:
 * missing fields get their defaults, invalid values fall back to defaults,
 * unknown keys are dropped. Never throws.
 */
export function validateSettings(raw: unknown): GroveBenchSettings {
  const input = typeof raw === 'object' && raw !== null ? raw : {};
  const result = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...input });
  return result.success ? (result.data as GroveBenchSettings) : { ...DEFAULT_SETTINGS };
}

/** Migrate + validate a parsed settings.json. Exported for tests. */
export function upgradeSettings(raw: unknown): { settings: GroveBenchSettings; migrated: boolean; fromVersion: number } {
  const { data, migrated, fromVersion, newerThanApp } = migrateRaw(raw, SETTINGS_MIGRATIONS, SETTINGS_SCHEMA_VERSION);
  if (newerThanApp) {
    console.warn(`[settings] settings.json is schema v${fromVersion}, newer than this app (v${SETTINGS_SCHEMA_VERSION}); unknown fields will be dropped on next save`);
  }
  return { settings: validateSettings(data), migrated, fromVersion };
}

let cached: GroveBenchSettings | null = null;

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function writeSettingsFile(settings: GroveBenchSettings): void {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(stampSchemaVersion(settings, SETTINGS_SCHEMA_VERSION), null, 2));
  } catch { /* ignore write errors */ }
}

export function loadSettings(): GroveBenchSettings {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8');
    const { settings, migrated } = upgradeSettings(JSON.parse(data));
    cached = settings;
    // Persist the upgraded shape so the migration only runs once.
    if (migrated) writeSettingsFile(settings);
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
  const clean = validateSettings(settings);
  cached = clean;
  writeSettingsFile(clean);
}

export function applyImmediateEffects(win: BrowserWindow | null, settings: GroveBenchSettings): void {
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(settings.alwaysOnTop);
  }
  nativeTheme.themeSource = settings.theme;
}
