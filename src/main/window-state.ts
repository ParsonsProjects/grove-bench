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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How much of the window's top edge must land on a display for the user to
 *  grab the title bar and drag it back. */
const MIN_VISIBLE_WIDTH = 100;
const TITLE_BAR_HEIGHT = 32;
/** Snapped windows can sit a few pixels outside the work area. */
const EDGE_SLACK = 16;

/** Drop a saved position whose title bar is no longer on any display (a
 *  monitor unplugged, a resolution change), so the window opens centred on
 *  the primary display instead of off-screen. */
export function keepOnScreen(state: WindowState, workAreas: Rect[]): WindowState {
  const { x, y, width } = state;
  if (x === undefined && y === undefined) return state;
  const reachable = Number.isFinite(x) && Number.isFinite(y) && workAreas.some((a) => {
    const overlap = Math.min(x! + width, a.x + a.width) - Math.max(x!, a.x);
    return overlap >= MIN_VISIBLE_WIDTH
      && y! >= a.y - EDGE_SLACK
      && y! + TITLE_BAR_HEIGHT <= a.y + a.height;
  });
  if (reachable) return state;
  const { x: _x, y: _y, ...rest } = state;
  return rest;
}

export function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(getStatePath(), 'utf-8');
    const state = JSON.parse(data) as WindowState;
    // Validate dimensions
    if (!Number.isFinite(state.width)) state.width = DEFAULT_STATE.width;
    if (!Number.isFinite(state.height)) state.height = DEFAULT_STATE.height;
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
