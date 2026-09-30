import { app, BrowserWindow, powerMonitor, screen } from 'electron';
import path from 'node:path';
import { registerHandlers, appEvents } from './ipc.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { keepOnScreen, loadWindowState, trackWindowState } from './window-state.js';
import { flushPendingSaves } from './app-state.js';
import * as settings from './settings.js';
import { logger } from './logger.js';
import { terminalManager } from './terminal.js';
import { previewManager } from './preview.js';
import { IPC } from '../shared/types.js';
import { initAdapters } from './adapters/index.js';
import { initAutoUpdater } from './auto-updater.js';
import { installProcessErrorHandlers } from './crash-handling.js';
import { installSpellcheckMenu } from './spellcheck.js';
import { lockToAppPage } from './window-guard.js';
import { runQuitCleanup } from './quit-cleanup.js';

// Keep userData path consistent across dev and packaged builds.
// In dev mode Electron defaults to "Electron"; electron-builder uses productName
// "Grove Bench".  Force it to the package.json "name" so all builds share the
// same data directory as the original Electron Forge build.
app.name = 'grove-bench';
app.setPath('userData', path.join(app.getPath('appData'), 'grove-bench'));

// Set the App User Model ID so Windows can associate the pinned taskbar
// shortcut with the running application (prevents icon from disappearing).
app.setAppUserModelId('com.parsonsprojects.grove-bench');

// Register built-in agent adapters before anything else uses them
initAdapters();

registerHandlers();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Log uncaught errors and forward them to the renderer instead of letting
// Electron's crash dialog take every agent session down with it.
installProcessErrorHandlers({ getWindow: () => mainWindow });

function createWindow() {
  const state = keepOnScreen(loadWindowState(), screen.getAllDisplays().map((d) => d.workArea));

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, '..', '..', 'src', 'main', 'icon.ico'),
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
  previewManager.setWindow(mainWindow);

  // Apply persisted settings on startup
  const appSettings = settings.loadSettings();
  if (appSettings.alwaysOnTop) mainWindow.setAlwaysOnTop(true);
  try {
    const { nativeTheme } = require('electron');
    nativeTheme.themeSource = appSettings.theme;
  } catch { /* nativeTheme may not be available */ }

  // Spell checker setup (the renderer draws the suggestion menu)
  installSpellcheckMenu(mainWindow.webContents);
  lockToAppPage(mainWindow.webContents);

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

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Claude's Preview pages are hidden windows; close them so the app quits.
    previewManager.setWindow(null);
    previewManager.closeAll();
  });

  logger.info('Grove Bench started');
}

app.whenReady().then(() => {
  createWindow();

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

// Graceful shutdown: stop every agent and shell. Worktrees, branches and
// checkpoints are left alone; conversations reopen on the next launch.
app.on('before-quit', (event) => {
  if (isQuitting) return;
  // Nothing running: no live conversation, none still closing (one closed
  // just before quitting), no terminal.
  if (sessionManager.count === 0 && sessionManager.closingCount === 0 && terminalManager.count === 0) {
    logger.close();
    return;
  }

  event.preventDefault();
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.APP_CLOSING);
  }
  logger.info(`Closing ${sessionManager.count} sessions...`);
  // closeAll() also waits for conversations already closing.
  runQuitCleanup(() => Promise.all([terminalManager.killAll(), sessionManager.closeAll()])).finally(() => {
    logger.close();
    app.quit();
  });
});
