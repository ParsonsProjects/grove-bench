import { autoUpdater } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { IPC } from '../shared/types.js';
import type { UpdateInfo, UpdateStatus } from '../shared/types.js';
import { logger } from './logger.js';

let mainWindow: BrowserWindow | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

function sendStatus(status: UpdateStatus) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPDATE_STATUS, status);
  }
}

function extractInfo(info: { version: string; releaseNotes?: string | unknown; releaseName?: string | null; releaseDate?: string }): UpdateInfo {
  return {
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    releaseName: info.releaseName ?? undefined,
    releaseDate: info.releaseDate,
  };
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', info: extractInfo(info) });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ state: 'downloading', percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', info: extractInfo(info) });
  });

  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error:', err.message);
    sendStatus({ state: 'error', message: err.message });
  });

  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }

  win.on('closed', () => {
    mainWindow = null;
    if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  });
}

export function checkForUpdate() {
  if (!app.isPackaged) return Promise.resolve(null);
  return autoUpdater.checkForUpdates();
}

export function downloadUpdate() {
  if (!app.isPackaged) return Promise.resolve();
  return autoUpdater.downloadUpdate();
}

export function installUpdate() { autoUpdater.quitAndInstall(false, true); }
