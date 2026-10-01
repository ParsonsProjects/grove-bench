import { autoUpdater } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { IPC } from '../shared/types.js';
import type { GroveBenchSettings, UpdateInfo, UpdateState, UpdateStatus } from '../shared/types.js';
import { getSettings } from './settings.js';
import { logger } from './logger.js';

/** Wait until session restore has settled before touching the network. */
const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;
/** Stops every agent and shell, as quitting does. Set by initAutoUpdater. */
let shutdown: () => Promise<void> = async () => {};
let listening = false;
let firstCheck: ReturnType<typeof setTimeout> | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

let status: UpdateStatus | null = null;
/** The version the latest check found, for the download statuses. */
let found: UpdateInfo | null = null;
/** What an 'error' event belongs to, and whether the user asked for it. */
let phase: 'check' | 'download' = 'check';
let manualCheck = false;
let manualDownload = false;
let restarting = false;

function setStatus(next: UpdateStatus) {
  status = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPDATE_STATUS, next);
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

function listen() {
  if (listening) return;
  listening = true;

  // electron-updater logs every step (and every error) through this.
  autoUpdater.logger = {
    info: (message?: unknown) => logger.info(`[updater] ${String(message)}`),
    warn: (message?: unknown) => logger.warn(`[updater] ${String(message)}`),
    error: (message?: unknown) => logger.error(`[updater] ${String(message)}`),
    debug: (message: string) => logger.debug(`[updater] ${message}`),
  };

  autoUpdater.on('checking-for-update', () => {
    phase = 'check';
    // Background checks stay quiet until they find something.
    if (manualCheck) setStatus({ state: 'checking', manual: true });
  });

  autoUpdater.on('update-available', (info) => {
    found = extractInfo(info);
    if (autoUpdater.autoDownload) {
      // electron-updater starts the download itself.
      phase = 'download';
      manualDownload = manualCheck;
      setStatus({ state: 'downloading', info: found, percent: 0, manual: manualDownload });
    } else {
      setStatus({ state: 'available', info: found });
    }
  });

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'not-available', manual: manualCheck });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (found) setStatus({ state: 'downloading', info: found, percent: progress.percent, manual: manualDownload });
  });

  autoUpdater.on('update-downloaded', (info) => {
    found = extractInfo(info);
    setStatus({ state: 'downloaded', info: found });
  });

  autoUpdater.on('error', (err) => {
    setStatus({
      state: 'error',
      message: err.message,
      during: phase,
      manual: phase === 'download' ? manualDownload : manualCheck,
    });
  });
}

function stopSchedule() {
  if (firstCheck) { clearTimeout(firstCheck); firstCheck = null; }
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
}

export function initAutoUpdater(win: BrowserWindow, options: { shutdown: () => Promise<void> }) {
  mainWindow = win;
  shutdown = options.shutdown;
  autoUpdater.autoDownload = getSettings().autoDownloadUpdates;
  // An update that's downloaded but not installed goes in when the app quits.
  autoUpdater.autoInstallOnAppQuit = true;
  listen();

  stopSchedule();
  if (app.isPackaged) {
    firstCheck = setTimeout(() => void runCheck(false), FIRST_CHECK_DELAY_MS);
    checkInterval = setInterval(() => void runCheck(false), CHECK_INTERVAL_MS);
  }

  win.on('closed', () => {
    mainWindow = null;
    stopSchedule();
  });
}

async function runCheck(manual: boolean): Promise<UpdateStatus | null> {
  if (!app.isPackaged) return null;
  if (manual) {
    manualCheck = true;
  } else if (status?.state === 'downloading' || status?.state === 'downloaded') {
    // Already on its way in; a background check has nothing to add.
    return status;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    // With automatic download on, the download carries on after the check
    // and rejects if it fails. The 'error' event reports that; catch it here
    // so it isn't an unhandled rejection.
    result?.downloadPromise?.catch(() => {});
  } catch {
    // Reported through the 'error' event.
  } finally {
    if (manual) manualCheck = false;
  }
  return status;
}

/** Check now, on the user's behalf. Resolves to the status once the check is
 *  done, or null in a dev build. */
export function checkForUpdate(): Promise<UpdateStatus | null> {
  return runCheck(true);
}

async function startDownload(manual: boolean): Promise<void> {
  if (!app.isPackaged) return;
  phase = 'download';
  manualDownload = manual;
  if (found) setStatus({ state: 'downloading', info: found, percent: 0, manual });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    // Reported through the 'error' event.
  }
}

/** Download the update the last check found (automatic download off). */
export function downloadUpdate(): Promise<void> {
  return startDownload(true);
}

/** Follow the "Download updates automatically" setting. Turning it on with
 *  an update already found starts that download. Nothing in a dev build:
 *  updates are off there, and reaching for the updater can throw (it refuses
 *  an app version that isn't semver), which failed every settings save. */
export function applyUpdateSettings(settings: Pick<GroveBenchSettings, 'autoDownloadUpdates'>) {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = settings.autoDownloadUpdates;
  if (settings.autoDownloadUpdates && status?.state === 'available') void startDownload(false);
}

export function getUpdateState(): UpdateState {
  return { currentVersion: app.getVersion(), enabled: app.isPackaged, status };
}

/**
 * Stop every agent and shell the way quitting does, then install the
 * downloaded update and reopen the app. Cleanup has to finish first: the
 * installer stops every process still running from the install folder a
 * second or two after it starts.
 */
export async function restartToUpdate(): Promise<void> {
  // A second quitAndInstall() call clears electron-updater's record of the
  // first, and its quit hook would then start the installer again.
  if (!app.isPackaged || status?.state !== 'downloaded' || restarting) return;
  restarting = true;
  logger.info(`Restarting to install ${status.info.version}`);
  await shutdown();
  // Silent, since the user has already chosen to update; reopen afterwards.
  autoUpdater.quitAndInstall(true, true);
}
