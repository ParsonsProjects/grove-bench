import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

interface AppState {
  activeTabId: string | null;
}

const DEFAULT_STATE: AppState = { activeTabId: null };

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

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveActiveTab(id: string | null): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const state = loadAppState();
      state.activeTabId = id;
      fs.writeFileSync(getStatePath(), JSON.stringify(state));
    } catch { /* ignore */ }
  }, 500);
}
