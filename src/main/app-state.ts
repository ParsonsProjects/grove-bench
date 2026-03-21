import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

interface AppState {
  activeTabId: string | null;
  openTabIds: string[];
}

const DEFAULT_STATE: AppState = { activeTabId: null, openTabIds: [] };

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
  writePendingActiveTab();
  writePendingOpenTabs();
}
