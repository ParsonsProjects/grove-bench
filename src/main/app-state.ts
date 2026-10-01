import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

import { COLLAPSIBLE_PANELS, type CollapsedPanels, type ConversationGroup, type PrerequisiteStatus, type SessionSortState, type SkillSuggestion } from '../shared/types.js';
import { migrateRaw, stampSchemaVersion, type Migration } from './persisted-state.js';
import { readJsonFile, writeFileAtomicSync } from './json-file.js';

export interface PrerequisiteCache {
  status: PrerequisiteStatus;
  checkedAt: number;
}

export interface ModelCatalogCache {
  models: unknown[];
  fetchedAt: number;
}

export interface SkillSuggestionCache {
  suggestions: SkillSuggestion[];
  /** Suggestion ids the user dismissed — never resurface these. */
  dismissedIds: string[];
  analyzedAt: number;
}

export interface AppState {
  openTabIds: string[];
  collapsedRepos: Record<string, boolean>;
  sessionSort: SessionSortState;
  /** Sidebar width in px (user-resizable). Null/absent = renderer default. */
  sidebarWidth?: number | null;
  /** Sidebars folded down to a rail. Absent = all open. */
  collapsedPanels?: CollapsedPanels;
  /** Skill names each repo's sessions have ever reported (union, per repo
   *  path). Lets the disabled-skills allowlist include plugin-provided skills
   *  that the on-disk scan can't discover, even on the first query after an
   *  app restart. */
  knownSkills?: Record<string, string[]>;
  /** Last skill-suggestion analysis per repo path, including dismissals. */
  skillSuggestions?: Record<string, SkillSuggestionCache>;
  /** Last prerequisite check, pass or fail. Lets the renderer show the last
   *  known state at launch while a fresh check runs in the background. */
  prerequisiteCache?: PrerequisiteCache | null;
  /** Sessions flagged unread (finished a turn / got a PR alert while not
   *  focused) when the app last ran. Restored into the sidebar on launch. */
  unreadSessionIds?: string[];
  /** Model lists learned from each agent's own SDK/CLI, keyed by adapter id.
   *  Shown at the next launch until the agent reports its list again. The
   *  shape of `models` belongs to the adapter, which validates it on load. */
  modelCatalogs?: Record<string, ModelCatalogCache>;
  /** Projects the user added, in the order they were added. The manifest
   *  only knows projects that have conversations, so without this a project
   *  with none was forgotten at restart. Absent until first listed. */
  projects?: string[];
  /** Conversation groups from the sidebar. Absent until the first one. */
  groups?: ConversationGroup[];
}

const DEFAULT_STATE: AppState = {
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

/** Keeps the known panels' flags and drops anything else, so one bad entry
 *  (or a panel a newer version added) doesn't reset the rest. */
const collapsedPanelsSchema = z.record(z.string(), z.unknown()).transform((raw): CollapsedPanels => {
  const panels: CollapsedPanels = {};
  for (const key of COLLAPSIBLE_PANELS) {
    const value = raw[key];
    if (typeof value === 'boolean') panels[key] = value;
  }
  return panels;
});

const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  sessionIds: z.array(z.string()),
});

/** Keeps the well-formed groups and drops the rest, so one bad entry doesn't
 *  lose every group. */
const groupsSchema = z.array(z.unknown()).transform((raw): ConversationGroup[] =>
  raw.flatMap((g) => {
    const parsed = groupSchema.safeParse(g);
    return parsed.success ? [parsed.data] : [];
  }));

/** Per-field fallback: a corrupt value resets that field only. */
const appStateSchema = z.object({
  openTabIds: z.array(z.string()).catch(DEFAULT_STATE.openTabIds),
  collapsedRepos: z.record(z.string(), z.boolean()).catch(DEFAULT_STATE.collapsedRepos),
  sessionSort: z.object({ key: z.enum(['name', 'age']), dir: z.enum(['asc', 'desc']) }).catch(DEFAULT_STATE.sessionSort),
  sidebarWidth: z.number().finite().nullable().optional().catch(null),
  collapsedPanels: collapsedPanelsSchema.optional().catch(undefined),
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
  modelCatalogs: z.record(z.string(), z.object({
    models: z.array(z.unknown()),
    fetchedAt: z.number(),
  })).optional().catch(undefined),
  projects: z.array(z.string()).optional().catch(undefined),
  groups: groupsSchema.optional().catch(undefined),
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
  writeFileAtomicSync(getStatePath(), JSON.stringify(stampSchemaVersion(state, APP_STATE_SCHEMA_VERSION)));
}

/** The saved state (defaults when missing or damaged), or null when the file
 *  exists but can't be read right now. */
function readAppState(): AppState | null {
  const read = readJsonFile(getStatePath());
  if (read.kind === 'unreadable') return null;
  if (read.kind !== 'ok') return { ...DEFAULT_STATE };
  const { state, migrated } = upgradeAppState(read.value);
  if (migrated) {
    try { writeAppState(state); } catch { /* ignore */ }
  }
  return state;
}

export function loadAppState(): AppState {
  return readAppState() ?? { ...DEFAULT_STATE };
}

/** Read-modify-write the state file. Skipped when the file can't be read, so
 *  a passing lock doesn't replace everything in it with defaults. Write
 *  errors are ignored (best-effort persistence, same as before versioning). */
function updateAppState(mutate: (state: AppState) => void): void {
  try {
    const state = readAppState();
    if (!state) return;
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

const openTabsWriter = debouncedWriter<string[]>((s, v) => { s.openTabIds = v; });
const collapsedReposWriter = debouncedWriter<Record<string, boolean>>((s, v) => { s.collapsedRepos = v; });
const sessionSortWriter = debouncedWriter<SessionSortState>((s, v) => { s.sessionSort = v; });
const sidebarWidthWriter = debouncedWriter<number>((s, v) => { s.sidebarWidth = v; });
const collapsedPanelsWriter = debouncedWriter<CollapsedPanels>((s, v) => { s.collapsedPanels = v; });
const unreadWriter = debouncedWriter<string[]>((s, v) => { s.unreadSessionIds = v; });

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

export function saveCollapsedPanels(panels: unknown): void {
  const parsed = collapsedPanelsSchema.safeParse(panels);
  if (parsed.success) collapsedPanelsWriter.save(parsed.data);
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
  const cache = loadAppState().prerequisiteCache ?? null;
  // Caches written before per-agent status had a single `agent` field.
  // Dropping them just means one fresh check at launch.
  const agents = (cache?.status as { agents?: unknown } | undefined)?.agents;
  if (!cache || typeof agents !== 'object' || agents === null) return null;
  return cache;
}

/** Write-through — prerequisite checks run once or twice per launch. */
export function savePrerequisiteCache(status: PrerequisiteStatus): void {
  updateAppState((state) => {
    state.prerequisiteCache = { status, checkedAt: Date.now() };
  });
}

/** The model list an agent last reported, or null. The caller validates it. */
export function loadModelCatalog(adapterId: string): unknown[] | null {
  return loadAppState().modelCatalogs?.[adapterId]?.models ?? null;
}

/** Write-through — an agent's model list is learned at most once per run. */
export function saveModelCatalog(adapterId: string, models: unknown[]): void {
  updateAppState((state) => {
    state.modelCatalogs = { ...(state.modelCatalogs ?? {}), [adapterId]: { models, fetchedAt: Date.now() } };
  });
}

export function loadConversationGroups(): ConversationGroup[] {
  return loadAppState().groups ?? [];
}

/** Write-through: groups are the user's own data and change only when they
 *  act. Junk from the renderer is ignored rather than saved. */
export function saveConversationGroups(groups: unknown): void {
  const parsed = groupsSchema.safeParse(groups);
  if (!parsed.success) return;
  updateAppState((state) => { state.groups = parsed.data; });
}

/** Flush any pending debounced saves immediately (e.g. before system suspend). */
export function flushPendingSaves(): void {
  for (const w of writers) w.flush();
}

// ─── Projects ───

/**
 * The project list: remembered projects in the order they were added, then
 * any project the manifest knows that isn't remembered yet (one with
 * conversations from before projects were remembered). Exported for tests.
 */
export function mergeProjects(remembered: string[] | undefined, fromManifest: string[]): string[] {
  const list = [...(remembered ?? [])];
  for (const repo of fromManifest) {
    if (!list.includes(repo)) list.push(repo);
  }
  return list;
}

/** Every project to show, remembering any the manifest adds. */
export function listProjects(fromManifest: string[]): string[] {
  const remembered = loadAppState().projects;
  const merged = mergeProjects(remembered, fromManifest);
  if (!remembered || merged.length !== remembered.length) {
    updateAppState((state) => { state.projects = merged; });
  }
  return merged;
}

/** Write-through — projects are added by hand. */
export function rememberProject(repoPath: string): void {
  updateAppState((state) => {
    const list = state.projects ?? [];
    if (!list.includes(repoPath)) state.projects = [...list, repoPath];
  });
}

export function forgetProject(repoPath: string): void {
  updateAppState((state) => {
    if (state.projects) state.projects = state.projects.filter((p) => p !== repoPath);
  });
}
