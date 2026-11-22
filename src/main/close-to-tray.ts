/**
 * Close to tray: with Settings > General > When you close the window set to
 * "Keep running in the tray", closing the window hides it instead, and the
 * threads keep working. A tray icon opens it again (click, or Open in its
 * menu), and its menu says how many threads are working or need you, and
 * quits.
 *
 * Quit stays the default, so nothing changes for anyone who doesn't ask. The
 * first time the window is closed with threads working, a dialog offers the
 * tray instead (Keep running in the tray, Quit, or Cancel). With the tray
 * chosen in Settings, the first time the window goes to the tray a
 * notification says where it went. Either way the user is told once
 * (app-state trayIntroduced).
 *
 * Quitting (the tray's Quit, the first-close dialog's, Restart to update or
 * Windows ending the session) closes the window for real: `markQuitting`
 * comes first, from before-quit.
 */
import { app, dialog, Menu, Notification, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { badgeDescription } from './attention-badge.js';
import { logger } from './logger.js';
import type { CloseWindowAction } from '../shared/types.js';

/** What closing the window does now: let it close (the app quits), hide it
 *  in the tray, or first offer the tray. */
export type CloseChoice = 'close' | 'hide' | 'offer';

export function closeChoice(o: { quitting: boolean; action: CloseWindowAction; working: number; introduced: boolean }): CloseChoice {
  if (o.quitting) return 'close';
  if (o.action === 'tray') return 'hide';
  return o.working > 0 && !o.introduced ? 'offer' : 'close';
}

export function threadsWorking(n: number): string {
  if (n <= 0) return 'No threads working';
  return n === 1 ? '1 thread working' : `${n} threads working`;
}

/** The tray's menu. Its status lines can't be clicked: they only say. */
export function trayMenuTemplate(
  status: { working: number; attention: number },
  actions: { open: () => void; quit: () => void },
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open Grove Bench', click: actions.open },
    { type: 'separator' },
    { label: threadsWorking(status.working), enabled: false },
    ...(status.attention > 0 ? [{ label: badgeDescription(status.attention), enabled: false }] : []),
    { type: 'separator' },
    { label: 'Quit Grove Bench', click: actions.quit },
  ];
}

/** The first-close dialog's buttons, in order. */
export const OFFER_BUTTONS = ['Keep running in the tray', 'Quit Grove Bench', 'Cancel'] as const;

export function offerText(working: number): { message: string; detail: string } {
  return {
    message: working === 1 ? '1 thread is still working' : `${working} threads are still working`,
    detail: 'Quitting stops them. Grove Bench can keep running in the tray instead, with the window closed, and you can open it again from the tray icon.\n\nYou can change this later in Settings > General > When you close the window.',
  };
}

export function noticeBody(working: number): string {
  const open = 'Open Grove Bench from the tray icon, or quit from its menu.';
  return working > 0 ? `${working === 1 ? '1 thread is' : `${working} threads are`} working. ${open}` : open;
}

export interface CloseToTrayOptions {
  getWindow: () => BrowserWindow | null;
  /** The .ico the window uses. */
  iconPath: string;
  closeAction: () => CloseWindowAction;
  /** Save the setting, and tell the window's settings. */
  setCloseAction: (action: CloseWindowAction) => void;
  /** Threads in a turn now. */
  working: () => number;
  introduced: () => boolean;
  setIntroduced: () => void;
}

export class CloseToTray {
  private opts: CloseToTrayOptions | null = null;
  private tray: Tray | null = null;
  private quitting = false;
  private offering = false;
  private attention = 0;
  /** Shown until it's dismissed: an unreferenced Notification can be
   *  garbage-collected while on screen, dropping its click handler. */
  private notice: Notification | null = null;

  install(opts: CloseToTrayOptions): void {
    this.opts = opts;
    this.apply(opts.closeAction());
  }

  /** The app is quitting: let the window close. */
  markQuitting(): void {
    this.quitting = true;
  }

  /** How many threads need the user, as the taskbar badge counts them. */
  noteAttention(count: number): void {
    this.attention = Math.max(0, count);
  }

  /** The setting changed (or the app started): the icon shows while it's
   *  the tray, and goes when it's Quit, unless the window is hidden in it. */
  apply(action: CloseWindowAction): void {
    if (action === 'tray') {
      this.ensureTray();
      return;
    }
    const win = this.opts?.getWindow();
    if (win && !win.isDestroyed() && !win.isVisible()) return;
    this.tray?.destroy();
    this.tray = null;
  }

  /** The window's 'close' event. */
  onClose(event: { preventDefault: () => void }): void {
    const opts = this.opts;
    if (!opts) return;
    const choice = closeChoice({
      quitting: this.quitting,
      action: opts.closeAction(),
      working: opts.working(),
      introduced: opts.introduced(),
    });
    if (choice === 'close') return;
    event.preventDefault();
    if (choice === 'hide') this.hide();
    else void this.offer();
  }

  /** Show the window, from the tray or its notice. */
  open(): void {
    const win = this.opts?.getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  quit(): void {
    this.quitting = true;
    app.quit();
  }

  private hide(): void {
    const opts = this.opts;
    const win = opts?.getWindow();
    if (!opts || !win || win.isDestroyed()) return;
    this.ensureTray();
    // With no icon to open it from, a hidden window would be lost:
    // minimised, it is still on the taskbar, and the threads keep working.
    if (!this.tray) {
      win.minimize();
      return;
    }
    win.hide();
    if (!opts.introduced()) {
      opts.setIntroduced();
      this.showNotice(opts.working());
    }
  }

  private async offer(): Promise<void> {
    const opts = this.opts;
    const win = opts?.getWindow();
    if (!opts || !win || win.isDestroyed() || this.offering) return;
    this.offering = true;
    try {
      const { message, detail } = offerText(opts.working());
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Grove Bench',
        message,
        detail,
        buttons: [...OFFER_BUTTONS],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (response === 0) {
        opts.setIntroduced();
        try {
          opts.setCloseAction('tray');
        } catch (e) {
          // The window still goes to the tray this time.
          logger.warn('Failed to save the close-to-tray setting:', e);
        }
        this.hide();
      } else if (response === 1) {
        opts.setIntroduced();
        this.quit();
      }
    } finally {
      this.offering = false;
    }
  }

  private ensureTray(): void {
    if (this.tray && !this.tray.isDestroyed()) return;
    const opts = this.opts;
    if (!opts) return;
    try {
      const tray = new Tray(opts.iconPath);
      tray.setToolTip('Grove Bench');
      tray.on('click', () => this.open());
      // Built when it opens, so its counts are current.
      tray.on('right-click', () => {
        tray.popUpContextMenu(Menu.buildFromTemplate(trayMenuTemplate(
          { working: opts.working(), attention: this.attention },
          { open: () => this.open(), quit: () => this.quit() },
        )));
      });
      this.tray = tray;
    } catch (e) {
      logger.warn('Failed to create the tray icon:', e);
    }
  }

  private showNotice(working: number): void {
    if (!Notification.isSupported()) return;
    try {
      const notice = new Notification({ title: 'Still running in the tray', body: noticeBody(working) });
      this.notice = notice;
      const release = () => { if (this.notice === notice) this.notice = null; };
      notice.on('click', () => {
        release();
        this.open();
      });
      notice.on('close', release);
      notice.on('failed', release);
      notice.show();
    } catch (e) {
      logger.warn('Failed to show the close-to-tray notice:', e);
    }
  }
}

export const closeToTray = new CloseToTray();
