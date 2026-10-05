import { app, BrowserWindow, ipcMain, powerMonitor, screen } from 'electron';
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
import { handleAttachmentProtocol, registerAttachmentScheme, removeDeletedFolders } from './attachments.js';
import { freezeLog, startStallWatch } from './freeze-log.js';
import { closePerfLog } from './perf-log.js';
import { startHealthLog } from './perf-health.js';
import { startProcessHost, stopProcessHost } from './process-host.js';
import { ChildProcess } from 'node:child_process';

// Time every process launch from the start: on Windows each one blocks the
// main process until the OS has created it (freeze-log.ts).
freezeLog.timeProcessLaunches(ChildProcess.prototype);

// Keep userData path consistent across dev and packaged builds.
// In dev mode Electron defaults to "Electron"; electron-builder uses productName
// "Grove Bench".  Force it to the package.json "name" so all builds share the
// same data directory as the original Electron Forge build.
app.name = 'grove-bench';
app.setPath('userData', path.join(app.getPath('appData'), 'grove-bench'));

// Set the App User Model ID so Windows can associate the pinned taskbar
// shortcut with the running application (prevents icon from disappearing).
app.setAppUserModelId('com.parsonsprojects.grove-bench');

// Register agent adapters before anything else uses them. The user's own
// ACP agents come from settings, so a change applies after a restart.
initAdapters(settings.loadSettings().acpAgents);

// Custom schemes can only be registered before the app is ready.
registerAttachmentScheme();

// Time IPC handlers before they are registered, so the freeze log can name
// the calls that ran while the main process was blocked.
freezeLog.timeIpcHandlers(ipcMain);
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
  // The saved theme isn't applied yet (see applyImmediateEffects).

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

  initAutoUpdater(mainWindow, { shutdown });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The agent's Preview pages are hidden windows; close them so the app quits.
    previewManager.setWindow(null);
    previewManager.closeAll();
  });

  logger.info('Grove Bench started');
}

app.whenReady().then(() => {
  // git and gh launch from here on in a utility process, so a slow launch
  // can't freeze the window (process-host.ts). First, before the window
  // starts asking for git status.
  startProcessHost();
  handleAttachmentProtocol();
  void removeDeletedFolders();
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

  // Note in the performance log whenever the main process stops
  // responding, and sum up how the app is doing every few minutes.
  startStallWatch(powerMonitor);
  startHealthLog({
    takeFreezeStats: freezeLog.takeStats,
    getAppMetrics: () => app.getAppMetrics(),
    counts: () => {
      const sessions = sessionManager.listSessions();
      return {
        conversations: sessions.length,
        asleep: sessions.filter((s) => s.status === 'sleeping').length,
        terminals: terminalManager.count,
      };
    },
  });

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

// After shutdown (before-quit waits for it), so the agents' last git calls
// still had the host; stopping it first means its exit isn't taken for a crash.
app.on('will-quit', () => {
  stopProcessHost();
});

/** Nothing running: no live conversation, none still closing (one closed
 *  just before quitting), no terminal. */
function nothingRunning(): boolean {
  return sessionManager.count === 0 && sessionManager.closingCount === 0 && terminalManager.count === 0;
}

let shutdownDone: Promise<void> | null = null;

/**
 * Graceful shutdown: stop every agent and shell. Worktrees, branches and
 * checkpoints are left alone; conversations reopen on the next launch.
 * Runs once: quitting and "Restart to update" both wait on it.
 */
function shutdown(): Promise<void> {
  shutdownDone ??= (async () => {
    if (nothingRunning()) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.APP_CLOSING);
    }
    logger.info(`Closing ${sessionManager.count} sessions...`);
    // closeAll() also waits for conversations already closing.
    await runQuitCleanup(() => Promise.all([terminalManager.killAll(), sessionManager.closeAll()]));
  })();
  return shutdownDone;
}

app.on('before-quit', (event) => {
  // Debounced app-state saves (open tabs, groups, …) still waiting to be written.
  flushPendingSaves();
  if (isQuitting) return;
  if (!shutdownDone && nothingRunning()) {
    logger.close();
    closePerfLog();
    return;
  }

  event.preventDefault();
  isQuitting = true;
  shutdown().finally(() => {
    logger.close();
    closePerfLog();
    app.quit();
  });
});
