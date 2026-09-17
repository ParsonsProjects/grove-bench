import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

import type { PrerequisiteStatus, SessionSortState, SkillSuggestion } from '../shared/types.js';
import { migrateRaw, stampSchemaVersion, type Migration } from './persisted-state.js';

export interface PrerequisiteCache {
  status: PrerequisiteStatus;
  checkedAt: number;
}

export interface SkillSuggestionCache {
  suggestions: SkillSuggestion[];
  /** Suggestion ids the user dismissed — never resurface these. */
  dismissedIds: string[];
  analyzedAt: number;
}

export interface AppState {
  activeTabId: string | null;
  openTabIds: string[];
  collapsedRepos: Record<string, boolean>;
  sessionSort: SessionSortState;
  /** Sidebar width in px (user-resizable). Null/absent = renderer default. */
  sidebarWidth?: number | null;
  /** Skill names each repo's sessions have ever reported (union, per repo
   *  path). Lets the disabled-skills allowlist include plugin-provided skills
   *  that the on-disk scan can't discover, even on the first query after an
   *  app restart. */
  knownSkills?: Record<string, string[]>;
  /** Last skill-suggestion analysis per repo path, including dismissals. */
  skillSuggestions?: Record<string, SkillSuggestionCache>;
  /** Last prerequisite check that passed. Lets the renderer skip the blocking
   *  startup overlay and re-verify in the background. Cleared on failure. */
  prerequisiteCache?: PrerequisiteCache | null;
  /** Sessions flagged unread (finished a turn / got a PR alert while not
   *  focused) when the app last ran. Restored into the sidebar on launch. */
  unreadSessionIds?: string[];
}

const DEFAULT_STATE: AppState = {
  activeTabId: null,
  openTabIds: [],
  collapsedRepos: {},
  sessionSort: { key: 'name', dir: 'asc' },
  sidebarWidth: null,
};

// ─── Schema versioning ───

/** Bump when a persisted field changes meaning or shape, and add a migration
 *  below. New optional fields need no bump. */
export const APP_STATE_SCHEMA_VERSION = 1;

/** `APP_STATE_MIGRATIONS[n]` upgrades a version-n state object to n+1. */
export const APP_STATE_MIGRATIONS: readonly Migration[] = [
  // 0 → 1: the unversioned layout. Nothing changed shape; this step only
  // exists so version-0 files get stamped and future migrations have a
  // well-defined starting point.
  (raw) => raw,
];

// ─── Validation ───

/** Per-field fallback: a corrupt value resets that field only. */
const appStateSchema = z.object({
  activeTabId: z.string().nullable().catch(DEFAULT_STATE.activeTabId),
  openTabIds: z.array(z.string()).catch(DEFAULT_STATE.openTabIds),
  collapsedRepos: z.record(z.string(), z.boolean()).catch(DEFAULT_STATE.collapsedRepos),
  sessionSort: z.object({ key: z.enum(['name', 'age']), dir: z.enum(['asc', 'desc']) }).catch(DEFAULT_STATE.sessionSort),
  sidebarWidth: z.number().finite().nullable().optional().catch(null),
  knownSkills: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
  skillSuggestions: z.record(z.string(), z.object({
    suggestions: z.array(z.custom<SkillSuggestion>((v) => typeof v === 'object' && v !== null)),
    dismissedIds: z.array(z.string()),
    analyzedAt: z.number(),
  })).optional().catch(undefined),
  prerequisiteCache: z.object({
    status: z.custom<PrerequisiteStatus>((v) => typeof v === 'object' && v !== null),
    checkedAt: z.number(),
  }).nullable().optional().catch(null),
  unreadSessionIds: z.array(z.string()).optional().catch(undefined),
}) satisfies z.ZodType<AppState, unknown>;

/** Normalize a raw object into a valid AppState. Never throws. */
export function validateAppState(raw: unknown): AppState {
  const input = typeof raw === 'object' && raw !== null ? raw : {};
  const result = appStateSchema.safeParse({ ...DEFAULT_STATE, ...input });
  return result.success ? (result.data as AppState) : { ...DEFAULT_STATE };
}

/** Migrate + validate a parsed app-state.json. Exported for tests. */
export function upgradeAppState(raw: unknown): { state: AppState; migrated: boolean; fromVersion: number } {
  const { data, migrated, fromVersion, newerThanApp } = migrateRaw(raw, APP_STATE_MIGRATIONS, APP_STATE_SCHEMA_VERSION);
  if (newerThanApp) {
    console.warn(`[app-state] app-state.json is schema v${fromVersion}, newer than this app (v${APP_STATE_SCHEMA_VERSION})`);
  }
  return { state: validateAppState(data), migrated, fromVersion };
}

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'app-state.json');
}

function writeAppState(state: AppState): void {
  fs.writeFileSync(getStatePath(), JSON.stringify(stampSchemaVersion(state, APP_STATE_SCHEMA_VERSION)));
}

export function loadAppState(): AppState {
  try {
    const data = fs.readFileSync(getStatePath(), 'utf-8');
    const { state, migrated } = upgradeAppState(JSON.parse(data));
    if (migrated) {
      try { writeAppState(state); } catch { /* ignore */ }
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Read-modify-write the state file. Write errors are ignored (best-effort
 *  persistence, same as before versioning). */
function updateAppState(mutate: (state: AppState) => void): void {
  try {
    const state = loadAppState();
    mutate(state);
    writeAppState(state);
  } catch { /* ignore */ }
}

// ─── Debounced writers ───
// Frequent renderer-driven updates (tab switches, sidebar drags) are coalesced
// so we don't rewrite the file on every event. flushPendingSaves() writes
// everything outstanding immediately (before suspend, or before a read).

interface DebouncedWriter<T> {
  save(value: T): void;
  flush(): void;
}

const DEBOUNCE_MS = 500;
const writers: DebouncedWriter<never>[] = [];

function debouncedWriter<T>(apply: (state: AppState, value: T) => void): DebouncedWriter<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  const write = () => {
    if (!pending) return;
    const { value } = pending;
    pending = null;
    timer = null;
    updateAppState((state) => apply(state, value));
  };
  const writer: DebouncedWriter<T> = {
    save(value) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, DEBOUNCE_MS);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
  writers.push(writer as DebouncedWriter<never>);
  return writer;
}

const activeTabWriter = debouncedWriter<string | null>((s, v) => { s.activeTabId = v; });
const openTabsWriter = debouncedWriter<string[]>((s, v) => { s.openTabIds = v; });
const collapsedReposWriter = debouncedWriter<Record<string, boolean>>((s, v) => { s.collapsedRepos = v; });
const sessionSortWriter = debouncedWriter<SessionSortState>((s, v) => { s.sessionSort = v; });
const sidebarWidthWriter = debouncedWriter<number>((s, v) => { s.sidebarWidth = v; });
const unreadWriter = debouncedWriter<string[]>((s, v) => { s.unreadSessionIds = v; });

export function saveActiveTab(id: string | null): void {
  activeTabWriter.save(id);
}

export function saveOpenTabs(ids: string[]): void {
  openTabsWriter.save(ids);
}

export function saveCollapsedRepos(map: Record<string, boolean>): void {
  collapsedReposWriter.save(map);
}

export function saveSessionSort(sort: SessionSortState): void {
  sessionSortWriter.save(sort);
}

export function saveSidebarWidth(width: number): void {
  sidebarWidthWriter.save(width);
}

export function loadUnreadSessionIds(): string[] {
  return loadAppState().unreadSessionIds ?? [];
}

export function saveUnreadSessionIds(ids: string[]): void {
  unreadWriter.save(ids);
}

export function loadKnownSkills(repoPath: string): string[] {
  return loadAppState().knownSkills?.[repoPath] ?? [];
}

/** Write-through (no debounce) — system_init events are rare. */
export function saveKnownSkills(repoPath: string, skills: string[]): void {
  updateAppState((state) => {
    state.knownSkills = { ...(state.knownSkills ?? {}), [repoPath]: skills };
  });
}

export function loadSkillSuggestionCache(repoPath: string): SkillSuggestionCache | null {
  return loadAppState().skillSuggestions?.[repoPath] ?? null;
}

/** Write-through (no debounce) — analysis runs are rare. */
export function saveSkillSuggestionCache(repoPath: string, cache: SkillSuggestionCache): void {
  updateAppState((state) => {
    state.skillSuggestions = { ...(state.skillSuggestions ?? {}), [repoPath]: cache };
  });
}

export function loadPrerequisiteCache(): PrerequisiteCache | null {
  return loadAppState().prerequisiteCache ?? null;
}

/** Write-through — prerequisite checks run once or twice per launch. */
export function savePrerequisiteCache(status: PrerequisiteStatus): void {
  updateAppState((state) => {
    state.prerequisiteCache = { status, checkedAt: Date.now() };
  });
}

export function clearPrerequisiteCache(): void {
  try {
    const state = loadAppState();
    if (!state.prerequisiteCache) return;
    state.prerequisiteCache = null;
    writeAppState(state);
  } catch { /* ignore */ }
}

/** Flush any pending debounced saves immediately (e.g. before system suspend). */
export function flushPendingSaves(): void {
  for (const w of writers) w.flush();
}
