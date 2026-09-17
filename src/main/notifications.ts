import { Notification, BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { GroveBenchSettings, OsNotificationRequest } from '../shared/types.js';
import { logger } from './logger.js';

/** References to notifications that may still be on screen — see the GC note
 *  in showOsNotification. */
const liveNotifications = new Set<Notification>();

/** Which settings flag gates each notification kind. */
export function kindEnabled(settings: GroveBenchSettings, kind: OsNotificationRequest['kind']): boolean {
  switch (kind) {
    case 'turn_complete': return settings.notifyOnTurnComplete;
    case 'permission_request': return settings.notifyOnPermission;
    case 'pr_alert': return settings.notifyOnPrAlert;
  }
}

/** OS notifications only fire while the window is unfocused — a focused user
 *  already sees the in-app indicators (attention flash, alert chips). */
export function shouldNotify(
  settings: GroveBenchSettings,
  kind: OsNotificationRequest['kind'],
  windowFocused: boolean,
): boolean {
  return !windowFocused && kindEnabled(settings, kind);
}

/** Show a desktop notification for a session event. Clicking it restores and
 *  focuses the window and tells the renderer to switch to the session.
 *  Returns whether a notification was actually shown. */
export function showOsNotification(
  win: BrowserWindow,
  req: OsNotificationRequest,
  settings: GroveBenchSettings,
): boolean {
  if (!shouldNotify(settings, req.kind, win.isFocused())) return false;
  if (!Notification.isSupported()) return false;

  try {
    const notification = new Notification({ title: req.title, body: req.body });
    // Keep a reference until the toast is dismissed — an unreferenced
    // Notification can be garbage-collected while still visible, which
    // silently drops its click handler.
    liveNotifications.add(notification);
    const release = () => liveNotifications.delete(notification);
    notification.on('click', () => {
      release();
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(IPC.NOTIFY_FOCUS_SESSION, req.sessionId);
    });
    notification.on('close', release);
    notification.on('failed', release);
    notification.show();
  } catch (e) {
    logger.warn('Failed to show OS notification:', e);
    return false;
  }

  // flashFrame is cleared by the window's focus handler (see index.ts).
  if (settings.notifyTaskbarFlash && !win.isDestroyed()) {
    win.flashFrame(true);
  }
  return true;
}
