import { app, BrowserWindow, ipcMain, nativeTheme, powerMonitor, screen } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { registerHandlers, appEvents } from './ipc.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { keepOnScreen, loadWindowState, trackWindowState } from './window-state.js';
import { flushPendingSaves } from './app-state.js';
import * as settings from './settings.js';
import { catalogs } from './catalogs.js';
import { getLogDir, logger } from './logger.js';
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
import { describeGpuDevices, describeGpuFeatures, startupLog } from './startup-log.js';
import { safeMode, SAFE_MODE_SUMMARY } from './safe-mode.js';
import { ChildProcess } from 'node:child_process';

// Time every process launch from the start: on Windows each one blocks the
// main process until the OS has created it (freeze-log.ts).
freezeLog.timeProcessLaunches(ChildProcess.prototype);
// And note each one, with when it ended, in the startup log (startup-log.ts).
startupLog.watchProcessLaunches(ChildProcess.prototype);

// Keep userData path consistent across dev and packaged builds.
// In dev mode Electron defaults to "Electron"; electron-builder uses productName
// "Grove Bench".  Force it to the package.json "name" so all builds share the
// same data directory as the original Electron Forge build.
app.name = 'grove-bench';
app.setPath('userData', path.join(app.getPath('appData'), 'grove-bench'));

// One copy at a time. Every build uses the data folder above, so a second
// copy (a second launch, or the installed app beside `npm start`) would
// resume the same threads, start a second agent on each transcript and
// write the same event logs. It hands over to the first, which shows its
// window, and quits. Electron keys the lock on the data folder, so it is
// taken after setPath.
const isFirstCopy = app.requestSingleInstanceLock();
if (!isFirstCopy) {
  const message = 'Grove Bench is already running with this data folder; showing its window instead';
  logger.info(message);
  console.log(message);
  app.quit();
}

// The startup log is this copy's: a second one only hands over, and must
// not move the running copy's file aside.
if (isFirstCopy) {
  startupLog.begin({ file: path.join(getLogDir(), 'startup.log'), header: launchHeader(), heartbeat: describeMemory });
}

// Safe mode (safe-mode.ts) draws the window without the GPU, which has to
// be chosen before the app is ready.
if (safeMode) app.disableHardwareAcceleration();

// Set the App User Model ID so Windows can associate the pinned taskbar
// shortcut with the running application (prevents icon from disappearing).
app.setAppUserModelId('com.parsonsprojects.grove-bench');

// Register agent adapters before anything else uses them. The user's own
// ACP agents and other Claude accounts come from settings, so a change
// applies after a restart.
const launchSettings = settings.loadSettings();
initAdapters(launchSettings.acpAgents, launchSettings.claudeAccounts);
startupLog.step('settings read, agents registered');

// Custom schemes can only be registered before the app is ready.
registerAttachmentScheme();

// Time IPC handlers before they are registered, so the freeze log can name
// the calls that ran while the main process was blocked.
freezeLog.timeIpcHandlers(ipcMain);
startupLog.watchIpcHandlers(ipcMain);
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
  startupLog.step('window created');
  watchWindow(mainWindow);

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  trackWindowState(mainWindow);
  previewManager.setWindow(mainWindow);

  // Apply persisted settings on startup, the theme before the page loads so
  // it doesn't open dark and then switch
  settings.applyImmediateEffects(mainWindow, settings.loadSettings());
  // With the theme on System, Windows can switch it while the app runs
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(settings.windowBackground());
  });

  // Spell checker setup (the renderer draws the suggestion menu)
  installSpellcheckMenu(mainWindow.webContents);
  lockToAppPage(mainWindow.webContents);

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    startupLog.step('window shown');
    mainWindow?.show();
  });

  // Stop the taskbar flash (started by OS notifications) once the user returns.
  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false);
  });

  initAutoUpdater(mainWindow, { shutdown, checkOnSchedule: !safeMode });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The agent's Preview pages are hidden windows; close them so the app quits.
    previewManager.setWindow(null);
    previewManager.closeAll();
  });

  logger.info('Grove Bench started');
}

// A second copy was started: it quits, and this one comes to the front.
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // A second copy only hands over (above), and opens nothing.
  if (!isFirstCopy) return;
  startupLog.step('app ready');
  logGpu();
  // git and gh launch from here on in a utility process, so a slow launch
  // can't freeze the window (process-host.ts). First, before the window
  // starts asking for git status.
  startProcessHost();
  startupLog.step('process hosts starting');
  handleAttachmentProtocol((id) => worktreeManager.getWorktree(id)?.path);
  if (!safeMode) void removeDeletedFolders();
  createWindow();
  appEvents.once('restore-complete', () => startupLog.step('threads restored'));

  // Safe mode leaves out the background work below (safe-mode.ts).
  if (!safeMode) {
    // Background worktree sweep. The first run waits until the renderer has
    // finished restoring sessions (disk and CPU are busiest then), with a
    // 60s fallback if that signal never arrives; then every 15 minutes.
    const runSweep = () => {
      const done = startupLog.track('worktree cleanup');
      worktreeManager.sweepStaleWorktrees().then(() => done(), (e) => {
        done('failed');
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

    // The ACP Registry and models.dev (catalogs.ts): at most once a day, after
    // the restore, and only while the user allows it (Settings > Privacy).
    appEvents.once('restore-complete', () => setTimeout(() => {
      if (settings.getSettings().onlineCatalogs) void catalogs.refresh();
    }, 10_000));
    const scheduleSweep = () => setTimeout(() => { runSweep(); scheduleSweep(); }, 15 * 60_000);
    scheduleSweep();
  }

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
  startupLog.end('quitting');
  stopProcessHost();
  // A stall seen at the last tick waits for the next one, which won't come.
  freezeLog.flush();
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
  startupLog.step('quit asked for');
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

// A process of the app's own, such as the GPU process, crashed or was
// killed. The process hosts note their own exits (process-host.ts), and the
// window's renderer is watched in watchWindow.
app.on('child-process-gone', (_event, details) => {
  if (details.type === 'Utility') return;
  const line = `${details.type} process${details.name ? ` (${details.name})` : ''} gone: ${details.reason}, exit code ${details.exitCode}`;
  logger.warn(line);
  startupLog.step(line);
});

/** Log the window's renderer crashing or hanging, in the app log and the
 *  startup log. */
function watchWindow(win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => startupLog.step('window loaded'));
  win.webContents.on('render-process-gone', (_event, details) => {
    const line = `window's renderer gone: ${details.reason}, exit code ${details.exitCode}`;
    logger.warn(line);
    startupLog.step(line);
  });
  win.on('unresponsive', () => {
    logger.warn('Window stopped responding');
    startupLog.step('window stopped responding');
  });
  win.on('responsive', () => {
    logger.info('Window responding again');
    startupLog.step('window responding again');
  });
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/** The startup log's first lines: what is starting, on what. */
function launchHeader(): string[] {
  return [
    `Grove Bench ${app.getVersion()} starting (pid ${process.pid}), Electron ${process.versions.electron}, ${os.version()} ${os.release()}`,
    safeMode ? `safe mode: ${SAFE_MODE_SUMMARY}` : 'safe mode off',
    `memory ${gb(os.totalmem())} GB, ${gb(os.freemem())} GB free; ${os.cpus().length} CPUs`,
  ];
}

/** Free memory, and what Grove's processes use, for each heartbeat of the
 *  startup log: running out of memory freezes the whole computer too. */
function describeMemory(): string {
  const groveKb = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0);
  return `memory free ${gb(os.freemem())} of ${gb(os.totalmem())} GB, Grove ${Math.round(groveKb / 1024)} MB`;
}

/** The graphics card, its driver and what Chromium uses it for, in the
 *  startup log: a driver that hangs takes the screen with it. */
function logGpu(): void {
  startupLog.step(`GPU use: ${describeGpuFeatures(app.getGPUFeatureStatus())}`);
  app.getGPUInfo('basic').then(
    (info) => startupLog.step(`GPU: ${describeGpuDevices(info)}`),
    (e: unknown) => startupLog.step(`GPU unknown: ${e instanceof Error ? e.message : String(e)}`),
  );
}
