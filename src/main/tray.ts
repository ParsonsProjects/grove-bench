/**
 * System tray (notification area) icon.
 *
 * When "close to tray" is on, the title bar close button hides the window
 * instead of quitting, so agent conversations keep running. The tray icon is
 * the way back: click restores the window, the context menu offers Show and
 * Quit. The tooltip carries the attention count while the window is hidden
 * (the taskbar overlay badge is invisible then).
 */
import { BrowserWindow, Menu, Tray } from 'electron';
import { badgeDescription } from './attention-badge.js';
import { logger } from './logger.js';

const APP_NAME = 'Grove Bench';

/** Module-level reference: an unreferenced Tray is garbage-collected and its
 *  icon silently disappears. */
let tray: Tray | null = null;
let balloonShown = false;

export interface TrayOptions {
  /** Absolute path to the tray icon (.ico on Windows). */
  iconPath: string;
  /** Show and focus the main window. */
  show: () => void;
  /** Quit for real, bypassing the close-to-tray intercept. */
  quit: () => void;
}

export function tooltipText(attentionCount: number): string {
  const detail = badgeDescription(attentionCount);
  return detail ? `${APP_NAME}: ${detail}` : APP_NAME;
}

/** Create the tray icon if it does not exist yet. Safe to call repeatedly. */
export function ensureTray(opts: TrayOptions): Tray | null {
  if (tray && !tray.isDestroyed()) return tray;
  try {
    // Pass the path rather than a NativeImage: the Tray constructor loads
    // .ico files itself on Windows, which is the format we ship.
    tray = new Tray(opts.iconPath);
    tray.setToolTip(tooltipText(0));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Show ${APP_NAME}`, click: opts.show },
      { type: 'separator' },
      { label: 'Quit', click: opts.quit },
    ]));
    tray.on('click', opts.show);
    tray.on('balloon-click', opts.show);
    return tray;
  } catch (e) {
    logger.warn('Failed to create tray icon:', e);
    tray = null;
    return null;
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

/** Reflect the attention count in the tooltip. No-op without a tray. */
export function setTrayAttention(count: number): void {
  if (!tray || tray.isDestroyed()) return;
  try {
    tray.setToolTip(tooltipText(count));
  } catch (e) {
    logger.warn('Failed to update tray tooltip:', e);
  }
}

/** Tell the user, once per app run, that closing the window did not quit. */
export function showFirstHideBalloon(): void {
  if (balloonShown || !tray || tray.isDestroyed()) return;
  balloonShown = true;
  if (process.platform !== 'win32') return; // displayBalloon is Windows-only
  try {
    tray.displayBalloon({
      iconType: 'info',
      title: `${APP_NAME} is still running`,
      content: 'Your conversations keep running in the background. Click the tray icon to reopen the window, or right-click it to quit.',
      respectQuietTime: true,
    });
  } catch (e) {
    logger.warn('Failed to show tray balloon:', e);
  }
}

/** Restore a window from hidden or minimised and bring it to the front. */
export function restoreWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** Exported for tests. */
export function _resetForTests(): void {
  tray = null;
  balloonShown = false;
}
