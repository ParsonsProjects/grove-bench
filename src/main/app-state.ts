import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import type { SessionSortState } from '../shared/types.js';

interface AppState {
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
}

const DEFAULT_STATE: AppState = {
  activeTabId: null,
  openTabIds: [],
  collapsedRepos: {},
  sessionSort: { key: 'name', dir: 'asc' },
  sidebarWidth: null,
};

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'app-state.json');
}

export function loadAppState(): AppState {
  try {
    const data = fs.readFileSync(getStatePath(), 'utf-8');
    return JSON.parse(data) as AppState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

// Track pending values so flush can write them immediately
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingActiveTab: { value: string | null } | null = null;

export function saveActiveTab(id: string | null): void {
  pendingActiveTab = { value: id };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writePendingActiveTab();
  }, 500);
}

function writePendingActiveTab(): void {
  if (!pendingActiveTab) return;
  try {
    const state = loadAppState();
    state.activeTabId = pendingActiveTab.value;
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
  pendingActiveTab = null;
  saveTimer = null;
}

let openTabsTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOpenTabs: { value: string[] } | null = null;

export function saveOpenTabs(ids: string[]): void {
  pendingOpenTabs = { value: ids };
  if (openTabsTimer) clearTimeout(openTabsTimer);
  openTabsTimer = setTimeout(() => {
    writePendingOpenTabs();
  }, 500);
}

function writePendingOpenTabs(): void {
  if (!pendingOpenTabs) return;
  try {
    const state = loadAppState();
    state.openTabIds = pendingOpenTabs.value;
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
  pendingOpenTabs = null;
  openTabsTimer = null;
}

let collapsedReposTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCollapsedRepos: { value: Record<string, boolean> } | null = null;

export function saveCollapsedRepos(map: Record<string, boolean>): void {
  pendingCollapsedRepos = { value: map };
  if (collapsedReposTimer) clearTimeout(collapsedReposTimer);
  collapsedReposTimer = setTimeout(() => {
    writePendingCollapsedRepos();
  }, 500);
}

function writePendingCollapsedRepos(): void {
  if (!pendingCollapsedRepos) return;
  try {
    const state = loadAppState();
    state.collapsedRepos = pendingCollapsedRepos.value;
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
  pendingCollapsedRepos = null;
  collapsedReposTimer = null;
}

let sessionSortTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSessionSort: { value: SessionSortState } | null = null;

export function saveSessionSort(sort: SessionSortState): void {
  pendingSessionSort = { value: sort };
  if (sessionSortTimer) clearTimeout(sessionSortTimer);
  sessionSortTimer = setTimeout(() => {
    writePendingSessionSort();
  }, 500);
}

function writePendingSessionSort(): void {
  if (!pendingSessionSort) return;
  try {
    const state = loadAppState();
    state.sessionSort = pendingSessionSort.value;
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
  pendingSessionSort = null;
  sessionSortTimer = null;
}

let sidebarWidthTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSidebarWidth: { value: number } | null = null;

export function saveSidebarWidth(width: number): void {
  pendingSidebarWidth = { value: width };
  if (sidebarWidthTimer) clearTimeout(sidebarWidthTimer);
  sidebarWidthTimer = setTimeout(() => {
    writePendingSidebarWidth();
  }, 500);
}

function writePendingSidebarWidth(): void {
  if (!pendingSidebarWidth) return;
  try {
    const state = loadAppState();
    state.sidebarWidth = pendingSidebarWidth.value;
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
  pendingSidebarWidth = null;
  sidebarWidthTimer = null;
}

export function loadKnownSkills(repoPath: string): string[] {
  return loadAppState().knownSkills?.[repoPath] ?? [];
}

/** Write-through (no debounce) — system_init events are rare. */
export function saveKnownSkills(repoPath: string, skills: string[]): void {
  try {
    const state = loadAppState();
    state.knownSkills = { ...(state.knownSkills ?? {}), [repoPath]: skills };
    fs.writeFileSync(getStatePath(), JSON.stringify(state));
  } catch { /* ignore */ }
}

/** Flush any pending debounced saves immediately (e.g. before system suspend). */
export function flushPendingSaves(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (openTabsTimer) {
    clearTimeout(openTabsTimer);
    openTabsTimer = null;
  }
  if (collapsedReposTimer) {
    clearTimeout(collapsedReposTimer);
    collapsedReposTimer = null;
  }
  if (sessionSortTimer) {
    clearTimeout(sessionSortTimer);
    sessionSortTimer = null;
  }
  if (sidebarWidthTimer) {
    clearTimeout(sidebarWidthTimer);
    sidebarWidthTimer = null;
  }
  writePendingActiveTab();
  writePendingOpenTabs();
  writePendingCollapsedRepos();
  writePendingSessionSort();
  writePendingSidebarWidth();
}
