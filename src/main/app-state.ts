import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

import { COLLAPSIBLE_PANELS, type CollapsedPanels, type ConversationGroup, type PrerequisiteStatus, type ProviderUsage, type SessionSortState, type SkillSuggestion } from '../shared/types.js';
import { migrateRaw, stampSchemaVersion, type Migration } from './persisted-state.js';
import { readJsonFile, readJsonFileAsync, writeFileAtomic, writeFileAtomicSync, type AtomicWrite, type JsonFileRead } from './json-file.js';
import { freezeLog } from './freeze-log.js';
import { logger } from './logger.js';
import { skillSchedulesSchema } from './skill-schedule-schema.js';
import type { SkillSchedule } from '../shared/skill-schedules.js';

export interface PrerequisiteCache {
  status: PrerequisiteStatus;
  checkedAt: number;
}

export interface ModelCatalogCache {
  models: unknown[];
  fetchedAt: number;
}

export interface AgentSignInRecord {
  signedIn: boolean;
  /** The agent's own words when it turned Grove down. */
  message?: string;
  checkedAt: number;
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
  /** Threads flagged To do in the sidebar. Unlike unread, only the user sets
   *  or clears one, so ids of threads that didn't load (their project folder
   *  is missing) are kept for when they come back. */
  todoSessionIds?: string[];
  /** Model lists learned from each agent's own SDK/CLI, keyed by adapter id.
   *  Shown at the next launch until the agent reports its list again. The
   *  shape of `models` belongs to the adapter, which validates it on load. */
  modelCatalogs?: Record<string, ModelCatalogCache>;
  /** The plan usage each agent last reported, keyed by adapter id, so a new
   *  conversation (or the next launch) shows it before the agent connects. */
  usageSnapshots?: Record<string, ProviderUsage>;
  /** Whether each agent that signs in through its own CLI was signed in the
   *  last time Grove found out (a conversation starting, or Check sign-in). */
  agentSignIn?: Record<string, AgentSignInRecord>;
  /** Projects the user added, in the order they were added. The manifest
   *  only knows projects that have conversations, so without this a project
   *  with none was forgotten at restart. Absent until first listed. */
  projects?: string[];
  /** Conversation groups from the sidebar. Absent until the first one. */
  groups?: ConversationGroup[];
  /** Estimated spend so far on `day` (local YYYY-MM-DD) across threads, for
   *  the daily spend limit, and where the limit stands once the user chose
   *  to continue past it that day. */
  dailySpend?: DailySpend;
  /** Skills run on a schedule (skill-schedules.ts). Absent until the first. */
  skillSchedules?: SkillSchedule[];
}

export interface DailySpend {
  day: string;
  usd: number;
  allowanceUsd?: number;
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
  sessionIds: z.array(z.string()),
});

/** A list of thread ids, as the To do flags are saved. */
const sessionIdsSchema = z.array(z.string());

/** Keeps the well-formed groups and drops the rest, so one bad entry doesn't
 *  lose every group. A conversation listed twice keeps its first place only
 *  (the sidebar keys rows by conversation), and a group left with none goes. */
const groupsSchema = z.array(z.unknown()).transform((raw): ConversationGroup[] => {
  const seen = new Set<string>();
  return raw.flatMap((g) => {
    const parsed = groupSchema.safeParse(g);
    if (!parsed.success) return [];
    const sessionIds = parsed.data.sessionIds.filter((id) => !seen.has(id) && !!seen.add(id));
    return sessionIds.length > 0 ? [{ ...parsed.data, sessionIds }] : [];
  });
});

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
  todoSessionIds: sessionIdsSchema.optional().catch(undefined),
  modelCatalogs: z.record(z.string(), z.object({
    models: z.array(z.unknown()),
    fetchedAt: z.number(),
  })).optional().catch(undefined),
  agentSignIn: z.record(z.string(), z.object({
    signedIn: z.boolean(),
    message: z.string().optional(),
    checkedAt: z.number(),
  })).optional().catch(undefined),
  usageSnapshots: z.record(z.string(), z.object({
    available: z.boolean(),
    plan: z.string().nullable().optional(),
    windows: z.array(z.object({
      id: z.string(),
      label: z.string(),
      utilization: z.number(),
      resetsAt: z.number().optional(),
    })),
    fetchedAt: z.number(),
    updatedAt: z.number().optional(),
  })).optional().catch(undefined),
  projects: z.array(z.string()).optional().catch(undefined),
  groups: groupsSchema.optional().catch(undefined),
  dailySpend: z.object({
    day: z.string(),
    usd: z.number().finite().nonnegative(),
    allowanceUsd: z.number().finite().nonnegative().optional(),
  }).optional().catch(undefined),
  skillSchedules: skillSchedulesSchema.optional().catch(undefined),
}) satisfies z.ZodType<AppState, unknown>;

/** Normalize a raw object into a valid AppState. Never throws. */
export function validateAppState(raw: unknown): AppState {
  const input = typeof raw === 'object' && raw !== null ? raw : {};
  const result = appStateSchema.safeParse({ ...DEFAULT_STATE, ...input });
  return result.success ? result.data : { ...DEFAULT_STATE };
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

function serialize(state: AppState): string {
  return JSON.stringify(stampSchemaVersion(state, APP_STATE_SCHEMA_VERSION));
}

// ─── The state in memory ───
// The file is read once, the first time the state is needed, and kept here:
// every change applies to this copy and a save writes it out whole, so
// neither saving nor loading reads the file again. That is safe because
// nothing else writes app-state.json. Only this module does (settings and
// the rest have files of their own), and Grove takes the single-instance
// lock on its data folder (index.ts), so a second copy can't run beside it.
// A read that finds the file locked is not kept as defaults: the next load
// or save reads it again, and changes made meanwhile wait for that read
// rather than be written over defaults.

/** The state as read from the file, with every change since. Null until a
 *  read succeeds (a missing or damaged file reads as the defaults). */
let memory: AppState | null = null;
/** Changes made while `memory` is null, applied in order once the file is
 *  read. Keyed, so a value saved again replaces the one waiting. */
const waiting = new Map<string, (state: AppState) => void>();
let waitingKeys = 0;
/** Changes made, and how many of them the file has. */
let changeCount = 0;
let savedCount = 0;

const fieldSchemas = appStateSchema.shape as unknown as Record<string, z.ZodType>;

/** Check a changed field as reading it back from the file would (a JSON
 *  copy, validated), so the state in memory is what the next launch reads
 *  and shares no objects with the caller. */
function normalizeField(state: Record<string, unknown>, key: string): void {
  let raw: unknown;
  try {
    raw = state[key] === undefined ? undefined : JSON.parse(JSON.stringify(state[key]));
  } catch {
    raw = undefined;
  }
  const parsed = fieldSchemas[key]?.safeParse(raw);
  if (parsed?.success && parsed.data !== undefined) state[key] = parsed.data;
  else delete state[key];
}

function applyChange(state: AppState, mutate: (state: AppState) => void): void {
  const before: Record<string, unknown> = { ...state };
  try {
    mutate(state);
  } catch (err) {
    logger.warn('[app-state] a change failed:', err);
  }
  // Changes replace a field's value rather than edit it in place.
  const after = state as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (after[key] !== before[key]) normalizeField(after, key);
  }
}

/** Take a read of the file as the state in memory, with the changes that
 *  waited for it. Null when the file couldn't be read. */
function adopt(read: JsonFileRead): AppState | null {
  if (memory) return memory; // read meanwhile, by a load or a save
  if (read.kind === 'unreadable') return null;
  const { state, migrated } = read.kind === 'ok'
    ? upgradeAppState(read.value)
    : { state: structuredClone(DEFAULT_STATE), migrated: false };
  memory = state;
  for (const mutate of waiting.values()) applyChange(state, mutate);
  waiting.clear();
  // Stamp the file with this version.
  if (migrated) changeCount++;
  if (savedCount < changeCount) startSaving();
  return state;
}

/** The state now. The first call reads the file (as does every call while
 *  it can't be read); null when it can't be. */
function currentState(): AppState | null {
  return memory ?? freezeLog.timeWork('app state read', () => adopt(readJsonFile(getStatePath())));
}

/** A copy of part of the state (of the defaults while the file can't be
 *  read), so a caller changing it doesn't change the state unsaved. */
function pick<T>(get: (state: AppState) => T): T {
  return structuredClone(get(currentState() ?? DEFAULT_STATE));
}

export function loadAppState(): AppState {
  return pick((state) => state);
}

/** Change the state and save it, in the background within `delayMs`, or
 *  (0) now, synchronously, before returning: for rare changes the user would
 *  miss after a crash or a kill (a project added), written as a flush is.
 *  `key` names what the change sets: while the file can't be read, a later
 *  change with the same key replaces this one. */
function change(mutate: (state: AppState) => void, delayMs: number, key = `#${++waitingKeys}`): void {
  changeCount++;
  if (memory) {
    applyChange(memory, mutate);
  } else {
    waiting.delete(key);
    waiting.set(key, mutate);
  }
  if (delayMs === 0) writeNow('app state write');
  else scheduleSave(delayMs);
}

// ─── Saving ───
// Saves run one at a time, in the background. The main process only turns
// the state into text (timed in the freeze log as "app state save"); the
// temp file is written and renamed over app-state.json off it, with timers
// between lock retries. A save writes every change made before it started,
// so changes made while one is on its way go out in the next, and the last
// change always ends up in the file. A save that fails, or finds the file
// unreadable, keeps its changes and tries again later, backing off: no
// background save starts before that try, so changes made meanwhile, however
// soon they were due, wait for it and go out with it.
//
// writeNow() writes synchronously instead: for rare changes (projects, the
// caches), and in flushPendingSaves() for quitting and system suspend, when a
// background save might not finish. It tries even while backing off, and any
// write that works ends the backoff.

/** The longest a change waits to be saved, so a burst (tab switches, a
 *  sidebar drag, rate-limit events from many threads) is one write, or one
 *  every half second for a long burst. */
const SAVE_DELAY_MS = 500;
/** The wait before trying a failed save again, doubling up to MAX_RETRY_MS. */
const RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The next try after a failed save, while backing off. */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** The save loop, while it runs. */
let saving: Promise<void> | null = null;
let failedTries = 0;

interface InFlight {
  write: AtomicWrite;
  /** changeCount when it started: the changes it writes. */
  upTo: number;
  /** Set by a flush that cancelled it; false when the cancel couldn't make
   *  sure it won't land. */
  stopped?: boolean;
}
/** The background write on its way to the file. */
let inFlight: InFlight | null = null;

function scheduleSave(delayMs: number): void {
  // A save that's running picks the change up when it's done, and after a
  // failed one the next try does.
  if (saveTimer || saving || retryTimer) return;
  saveTimer = setTimeout(startSaving, delayMs);
}

function startSaving(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // Backing off: the next try starts it.
  if (retryTimer) return;
  saving ??= saveLoop();
}

/** A save failed, or found the file unreadable: back off. A try already
 *  waiting keeps its time; the one after waits longer. */
function retryLater(): void {
  failedTries++;
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startSaving();
  }, Math.min(RETRY_MS * 2 ** (failedTries - 1), MAX_RETRY_MS));
}

/** A write landed: the disk takes them again, so stop backing off. */
function saveWorked(): void {
  failedTries = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

async function saveLoop(): Promise<void> {
  try {
    // Changes made in the same task go out in this save.
    await Promise.resolve();
    for (;;) {
      const state = memory ?? adopt(await readJsonFileAsync(getStatePath()));
      if (!state) {
        // Still unreadable: keep the changes rather than write them over
        // defaults.
        retryLater();
        return;
      }
      // A sync write that failed meanwhile started a backoff: its try saves
      // these.
      if (retryTimer || savedCount >= changeCount) return;
      const upTo = changeCount;
      const text = freezeLog.timeWork('app state save', () => serialize(state));
      const entry: InFlight = { write: writeFileAtomic(getStatePath(), text), upTo };
      inFlight = entry;
      let result: 'written' | 'cancelled';
      try {
        result = await entry.write.done;
      } catch (err) {
        logger.warn('[app-state] could not save app-state.json; trying again later:', err);
        retryLater();
        return;
      } finally {
        inFlight = null;
      }
      if (result === 'written') {
        saveWorked();
        // Landed after a flush that couldn't stop it, maybe over newer
        // changes: go round and write them again.
        savedCount = entry.stopped === false ? Math.min(savedCount, upTo) : Math.max(savedCount, upTo);
      }
      // Cancelled: a flush wrote these changes. Go round for any since.
    }
  } finally {
    saving = null;
  }
}

/**
 * Write every change the file doesn't have yet, now and synchronously. A
 * background write on its way is cancelled first, so it can't land after
 * this one with older changes. Tried even while backing off: a write that
 * works ends the backoff, with every change saved, and one that fails counts
 * as a failed try (the try already waiting keeps its time). Skipped, as
 * saves are, while the file has never been read and still can't be; the
 * background save reads it again, with longer lock retries.
 */
function writeNow(work: string): void {
  const unstopped = inFlight?.stopped === false;
  if (savedCount >= changeCount && !unstopped) return;
  freezeLog.timeWork(work, () => {
    const state = memory ?? adopt(readJsonFile(getStatePath()));
    if (!state) {
      startSaving();
      return;
    }
    if (inFlight) inFlight.stopped = inFlight.write.cancel();
    const upTo = changeCount;
    try {
      writeFileAtomicSync(getStatePath(), serialize(state));
    } catch (err) {
      logger.warn('[app-state] could not save app-state.json; trying again later:', err);
      retryLater();
      return;
    }
    savedCount = upTo;
    saveWorked();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  });
}

/** Write every change the file doesn't have yet, synchronously (writeNow):
 *  before quitting and before the system suspends, when a background save
 *  might not finish. */
export function flushPendingSaves(): void {
  writeNow('app state flush');
}

/** Test hook: resolves once no save is running. */
export function appStateSaved(): Promise<void> {
  return saving ?? Promise.resolve();
}

/** Test hook: forget the state in memory and any save not yet made, as at
 *  launch. Call once no save is running (appStateSaved). */
export function resetAppStateForTests(): void {
  if (saveTimer) clearTimeout(saveTimer);
  if (retryTimer) clearTimeout(retryTimer);
  saveTimer = null;
  retryTimer = null;
  memory = null;
  waiting.clear();
  changeCount = 0;
  savedCount = 0;
  failedTries = 0;
  inFlight = null;
  usageSnapshots = null;
  dailySpend = undefined;
}

// ─── Fields ───

/** Set a field, saved within SAVE_DELAY_MS: these come in bursts. */
function setSoon<K extends keyof AppState>(key: K, value: AppState[K]): void {
  change((state) => { state[key] = value; }, SAVE_DELAY_MS, key);
}

// Loads copy only the field they return, not the whole state (loadAppState).

export function loadOpenTabs(): string[] {
  return pick((state) => state.openTabIds);
}

export function saveOpenTabs(ids: string[]): void {
  setSoon('openTabIds', ids);
}

export function loadCollapsedRepos(): Record<string, boolean> {
  return pick((state) => state.collapsedRepos ?? {});
}

export function saveCollapsedRepos(map: Record<string, boolean>): void {
  setSoon('collapsedRepos', map);
}

export function loadSessionSort(): SessionSortState {
  return pick((state) => state.sessionSort ?? DEFAULT_STATE.sessionSort);
}

export function saveSessionSort(sort: SessionSortState): void {
  setSoon('sessionSort', sort);
}

export function loadSidebarWidth(): number | null {
  return pick((state) => state.sidebarWidth ?? null);
}

export function saveSidebarWidth(width: number): void {
  setSoon('sidebarWidth', width);
}

export function loadCollapsedPanels(): CollapsedPanels {
  return pick((state) => state.collapsedPanels ?? {});
}

export function saveCollapsedPanels(panels: unknown): void {
  const parsed = collapsedPanelsSchema.safeParse(panels);
  if (parsed.success) setSoon('collapsedPanels', parsed.data);
}

export function loadUnreadSessionIds(): string[] {
  return pick((state) => state.unreadSessionIds ?? []);
}

export function saveUnreadSessionIds(ids: string[]): void {
  setSoon('unreadSessionIds', ids);
}

/** The threads flagged To do, or null when the file exists but can't be read
 *  right now, as with the groups: "none" would let the next save wipe them. */
export function loadTodoSessionIds(): string[] | null {
  const state = currentState();
  return state ? [...(state.todoSessionIds ?? [])] : null;
}

/** Saved within SAVE_DELAY_MS, like the unread flags. Junk from the renderer
 *  is ignored. */
export function saveTodoSessionIds(ids: unknown): void {
  const parsed = sessionIdsSchema.safeParse(ids);
  if (parsed.success) setSoon('todoSessionIds', parsed.data);
}

export function loadKnownSkills(repoPath: string): string[] {
  return pick((state) => state.knownSkills?.[repoPath] ?? []);
}

/** Saved straight away (no delay): system_init events are rare. */
export function saveKnownSkills(repoPath: string, skills: string[]): void {
  change((state) => {
    state.knownSkills = { ...(state.knownSkills ?? {}), [repoPath]: skills };
  }, 0, `knownSkills:${repoPath}`);
}

export function loadSkillSuggestionCache(repoPath: string): SkillSuggestionCache | null {
  return pick((state) => state.skillSuggestions?.[repoPath] ?? null);
}

/** Saved straight away: analysis runs are rare. */
export function saveSkillSuggestionCache(repoPath: string, cache: SkillSuggestionCache): void {
  change((state) => {
    state.skillSuggestions = { ...(state.skillSuggestions ?? {}), [repoPath]: cache };
  }, 0, `skillSuggestions:${repoPath}`);
}

export function loadPrerequisiteCache(): PrerequisiteCache | null {
  const cache = pick((state) => state.prerequisiteCache ?? null);
  // Caches written before per-agent status had a single `agent` field.
  // Dropping them just means one fresh check at launch.
  const agents = (cache?.status as { agents?: unknown } | undefined)?.agents;
  if (!cache || typeof agents !== 'object' || agents === null) return null;
  return cache;
}

/** Saved straight away: prerequisite checks run once or twice per launch. */
export function savePrerequisiteCache(status: PrerequisiteStatus): void {
  const checkedAt = Date.now();
  change((state) => {
    state.prerequisiteCache = { status, checkedAt };
  }, 0, 'prerequisiteCache');
}

/** The model list an agent last reported, or null. The caller validates it. */
export function loadModelCatalog(adapterId: string): unknown[] | null {
  return pick((state) => state.modelCatalogs?.[adapterId]?.models ?? null);
}

/** Saved straight away: an agent's model list is learned at most once per run. */
export function saveModelCatalog(adapterId: string, models: unknown[]): void {
  const fetchedAt = Date.now();
  change((state) => {
    state.modelCatalogs = { ...(state.modelCatalogs ?? {}), [adapterId]: { models, fetchedAt } };
  }, 0, `modelCatalogs:${adapterId}`);
}

/** What Grove last learned about an agent's sign-in, or null. */
export function loadAgentSignIn(adapterId: string): AgentSignInRecord | null {
  return pick((state) => state.agentSignIn?.[adapterId] ?? null);
}

/** Saved straight away: only on a conversation start or a check, and only
 *  when the answer changes. */
export function saveAgentSignIn(adapterId: string, record: AgentSignInRecord): void {
  const prev = loadAgentSignIn(adapterId);
  if (prev && prev.signedIn === record.signedIn && prev.message === record.message) return;
  change((state) => {
    state.agentSignIn = { ...(state.agentSignIn ?? {}), [adapterId]: record };
  }, 0, `agentSignIn:${adapterId}`);
}

/** Kept apart once read: rate-limit events read it often, and while the
 *  file can't be read each read would wait out its locks again. */
let usageSnapshots: Record<string, ProviderUsage> | null = null;

/** The plan usage an agent last reported, or null. */
export function loadUsageSnapshot(adapterId: string): ProviderUsage | null {
  usageSnapshots ??= pick((state) => state.usageSnapshots ?? {});
  return usageSnapshots[adapterId] ?? null;
}

/** Saved within SAVE_DELAY_MS: rate-limit events can arrive with every reply. */
export function saveUsageSnapshot(adapterId: string, usage: ProviderUsage): void {
  usageSnapshots ??= pick((state) => state.usageSnapshots ?? {});
  usageSnapshots = { ...usageSnapshots, [adapterId]: usage };
  change((state) => {
    state.usageSnapshots = { ...(state.usageSnapshots ?? {}), [adapterId]: usage };
  }, SAVE_DELAY_MS, `usageSnapshots:${adapterId}`);
}

/** Kept apart once read, like usageSnapshots: every turn's result adds to it. */
let dailySpend: DailySpend | null | undefined;

/** Today's spend record as last saved (any day; the caller checks it). */
export function loadDailySpend(): DailySpend | null {
  if (dailySpend === undefined) dailySpend = pick((state) => state.dailySpend ?? null);
  return dailySpend;
}

/** Saved within SAVE_DELAY_MS: a turn ends in every thread that is running. */
export function saveDailySpend(spend: DailySpend): void {
  dailySpend = spend;
  setSoon('dailySpend', spend);
}

/** The saved groups, or null when the file exists but can't be read right
 *  now. The renderer saves its whole list back, so reading a passing lock as
 *  "no groups" would let its next save wipe them. */
export function loadConversationGroups(): ConversationGroup[] | null {
  const state = currentState();
  return state ? structuredClone(state.groups ?? []) : null;
}

/** Saved within SAVE_DELAY_MS: deleting several grouped conversations
 *  (removing a project, clean-up) sends one save each. Junk from the
 *  renderer is ignored. */
export function saveConversationGroups(groups: unknown): void {
  const parsed = groupsSchema.safeParse(groups);
  if (parsed.success) setSoon('groups', parsed.data);
}

// ─── Skill schedules ───

/** The saved schedules, or null when the file exists but can't be read right
 *  now, so a passing lock isn't read as "none" and saved over them. */
export function loadSkillSchedules(): SkillSchedule[] | null {
  const state = currentState();
  return state ? structuredClone(state.skillSchedules ?? []) : null;
}

/** Saved straight away when the user changed them (`now`), else within
 *  SAVE_DELAY_MS: a scheduled run's bookkeeping can wait half a second. */
export function saveSkillSchedules(schedules: SkillSchedule[], now: boolean): void {
  if (now) change((state) => { state.skillSchedules = schedules; }, 0, 'skillSchedules');
  else setSoon('skillSchedules', schedules);
}

/** Change the schedules as they are when the change applies: at once, or
 *  once the file can be read again, so a run's record isn't lost to a
 *  passing lock. Saved within SAVE_DELAY_MS. */
export function updateSkillSchedules(mutate: (schedules: SkillSchedule[]) => SkillSchedule[]): void {
  change((state) => { state.skillSchedules = mutate(structuredClone(state.skillSchedules ?? [])); }, SAVE_DELAY_MS);
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
  const remembered = pick((state) => state.projects);
  const merged = mergeProjects(remembered, fromManifest);
  if (!remembered || merged.length !== remembered.length) {
    // Merged again with the list the change finds, which is the file's
    // when this one came from defaults (the file couldn't be read).
    change((state) => { state.projects = mergeProjects(state.projects, fromManifest); }, 0);
  }
  return merged;
}

/** Saved straight away: projects are added by hand. */
export function rememberProject(repoPath: string): void {
  change((state) => {
    const list = state.projects ?? [];
    if (!list.includes(repoPath)) state.projects = [...list, repoPath];
  }, 0);
}

export function forgetProject(repoPath: string): void {
  change((state) => {
    if (state.projects) state.projects = state.projects.filter((p) => p !== repoPath);
  }, 0);
}
