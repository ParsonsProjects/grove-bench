/**
 * Taskbar / dock badge showing how many sessions need the user.
 *
 * The renderer owns the count (it has the triage state) and, for Windows,
 * draws the overlay bitmap itself — the main process has no canvas. Main
 * just applies it with the platform's native API.
 */
import { app, nativeImage, type BrowserWindow } from 'electron';
import { logger } from './logger.js';

export function badgeDescription(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 conversation needs attention' : `${count} conversations need attention`;
}

export function applyAttentionBadge(
  win: BrowserWindow,
  count: number,
  dataUrl: string | null,
  platform: NodeJS.Platform = process.platform,
): void {
  try {
    if (platform === 'win32') {
      const image = count > 0 && dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
      win.setOverlayIcon(image, badgeDescription(count));
    } else if (platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    } else {
      app.setBadgeCount(count);
    }
  } catch (e) {
    logger.warn('Failed to apply attention badge:', e);
  }
}
