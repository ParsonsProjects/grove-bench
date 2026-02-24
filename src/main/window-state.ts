import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1400,
  height: 900,
};

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(getStatePath(), 'utf-8');
    const state = JSON.parse(data) as WindowState;
    // Validate dimensions
    if (state.width < 800) state.width = 800;
    if (state.height < 600) state.height = 600;
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (win.isDestroyed()) return;

    const state: WindowState = {
      isMaximized: win.isMaximized(),
    } as WindowState;

    if (!win.isMaximized()) {
      const bounds = win.getBounds();
      state.x = bounds.x;
      state.y = bounds.y;
      state.width = bounds.width;
      state.height = bounds.height;
    } else {
      // Keep previous non-maximized dimensions
      try {
        const prev = JSON.parse(fs.readFileSync(getStatePath(), 'utf-8'));
        state.x = prev.x;
        state.y = prev.y;
        state.width = prev.width || DEFAULT_STATE.width;
        state.height = prev.height || DEFAULT_STATE.height;
      } catch {
        state.width = DEFAULT_STATE.width;
        state.height = DEFAULT_STATE.height;
      }
    }

    try {
      fs.writeFileSync(getStatePath(), JSON.stringify(state));
    } catch { /* ignore */ }
  };

  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  };

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', save);
}
