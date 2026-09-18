import { app, BrowserWindow, Menu, MenuItem, powerMonitor } from 'electron';
import path from 'node:path';
import { registerHandlers, appEvents } from './ipc.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { loadWindowState, trackWindowState } from './window-state.js';
import { flushPendingSaves } from './app-state.js';
import * as settings from './settings.js';
import { logger } from './logger.js';
import { terminalManager } from './terminal.js';
import { IPC } from '../shared/types.js';
import { initAdapters } from './adapters/index.js';
import { initAutoUpdater } from './auto-updater.js';
import { installProcessErrorHandlers } from './crash-handling.js';
import { ensureTray, destroyTray, restoreWindow, showFirstHideBalloon } from './tray.js';
import type { GroveBenchSettings } from '../shared/types.js';

// Keep userData path consistent across dev and packaged builds.
// In dev mode Electron defaults to "Electron"; electron-builder uses productName
// "Grove Bench".  Force it to the package.json "name" so all builds share the
// same data directory as the original Electron Forge build.
app.name = 'grove-bench';
app.setPath('userData', path.join(app.getPath('appData'), 'grove-bench'));

// Set the App User Model ID so Windows can associate the pinned taskbar
// shortcut with the running application (prevents icon from disappearing).
app.setAppUserModelId('com.parsonsprojects.grove-bench');

// One running copy per user data directory. With close-to-tray the window
// can be hidden while the app runs, so launching it again from the Start
// menu must surface the existing window rather than start a second copy
// fighting over the same state files and worktrees. The lock is keyed on
// userData, so it must come after setPath above.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// Register built-in agent adapters before anything else uses them
initAdapters();

registerHandlers();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
/** Set when the app should really exit: the window `close` intercept below
 *  hides to the tray unless this is true. */
let forceQuit = false;

function quitForReal() {
  forceQuit = true;
  app.quit();
}

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', '..', 'src', 'main', 'icon.ico');
}

/** Create or remove the tray icon to match the setting. */
function syncTray(appSettings: GroveBenchSettings) {
  if (appSettings.closeToTray) {
    ensureTray({
      iconPath: iconPath(),
      show: () => restoreWindow(mainWindow),
      quit: quitForReal,
    });
  } else {
    destroyTray();
  }
}

// Log uncaught errors and forward them to the renderer instead of letting
// Electron's crash dialog take every agent session down with it.
installProcessErrorHandlers({ getWindow: () => mainWindow });

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
    title: 'Grove Bench',
    show: false,
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  trackWindowState(mainWindow);

  // Apply persisted settings on startup
  const appSettings = settings.loadSettings();
  if (appSettings.alwaysOnTop) mainWindow.setAlwaysOnTop(true);
  try {
    const { nativeTheme } = require('electron');
    nativeTheme.themeSource = appSettings.theme;
  } catch { /* nativeTheme may not be available */ }

  // Spell checker setup
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) return;
    const menu = new Menu();
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      }));
    }
    if (params.dictionarySuggestions.length === 0) {
      menu.append(new MenuItem({ label: 'No suggestions', enabled: false }));
    }
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'Add to Dictionary',
      click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    }));
    menu.popup();
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Stop the taskbar flash (started by OS notifications) once the user returns.
  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false);
  });

  initAutoUpdater(mainWindow);

  // Close to tray: hide instead of closing so conversations keep running.
  // Every listener on `close` still runs (window-state saves its bounds);
  // preventDefault only stops the window from actually closing.
  mainWindow.on('close', (event) => {
    if (forceQuit || !settings.getSettings().closeToTray) return;
    event.preventDefault();
    mainWindow?.hide();
    showFirstHideBalloon();
  });

  // Windows is shutting down or the user is logging off: let the close
  // through so the normal quit cleanup runs instead of hiding the window.
  mainWindow.on('session-end', () => {
    forceQuit = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Grove Bench started');
}

app.on('second-instance', () => {
  restoreWindow(mainWindow);
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return; // quitting: another copy owns this userData
  createWindow();
  syncTray(settings.getSettings());
  appEvents.on('settings-changed', syncTray);

  // Background worktree sweep. The first run waits until the renderer has
  // finished restoring sessions (disk and CPU are busiest then), with a
  // 60s fallback if that signal never arrives; then every 15 minutes.
  const runSweep = () => {
    worktreeManager.sweepStaleWorktrees().catch((e) => {
      logger.warn('Background worktree sweep failed:', e);
    });
  };
  let firstSweepScheduled = false;
  const scheduleFirstSweep = () => {
    if (firstSweepScheduled) return;
    firstSweepScheduled = true;
    setTimeout(runSweep, 5_000);
  };
  appEvents.once('restore-complete', scheduleFirstSweep);
  setTimeout(scheduleFirstSweep, 60_000);
  const scheduleSweep = () => setTimeout(() => { runSweep(); scheduleSweep(); }, 15 * 60_000);
  scheduleSweep();

  // ─── Power monitor: flush state on suspend, health-check on resume ───
  powerMonitor.on('suspend', () => {
    logger.info('System suspending — flushing pending state saves');
    flushPendingSaves();
    sessionManager.captureSuspendState();
  });

  powerMonitor.on('resume', () => {
    logger.info('System resumed — running session health checks');
    const resumeIds = sessionManager.healthCheckAll();
    // Tell the renderer which tabs died during sleep so it can resume them all
    // (not just the focused one) instead of letting them drop to Inactive.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.POWER_RESUME, resumeIds);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Graceful shutdown: destroy all sessions and clean up worktrees
app.on('before-quit', (event) => {
  // app.quit() closes every window before exiting; the close intercept must
  // let them through or the quit is cancelled and the window just hides.
  // This also covers quits we did not start (auto-updater install, Ctrl+C).
  forceQuit = true;
  if (isQuitting) return;

  if (sessionManager.count > 0) {
    event.preventDefault();
    isQuitting = true;

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.APP_CLOSING);
    }

    (async () => {
      try {
        logger.info(`Cleaning up ${sessionManager.count} sessions...`);
        await terminalManager.killAll();
        await sessionManager.destroyAll();
        await new Promise((r) => setTimeout(r, 500));
        await worktreeManager.cleanupAll();
        logger.info('Cleanup complete');
      } catch (e) {
        logger.error('Cleanup error during quit:', e);
      } finally {
        destroyTray();
        logger.close();
        app.quit();
      }
    })();
  } else {
    destroyTray();
    logger.close();
  }
});
