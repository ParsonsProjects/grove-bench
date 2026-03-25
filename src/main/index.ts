import { app, BrowserWindow, Menu, MenuItem, powerMonitor } from 'electron';
import path from 'node:path';
import { registerHandlers } from './ipc.js';
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

// Keep userData path consistent across dev and packaged builds.
// In dev mode Electron defaults to "Electron"; electron-builder uses productName
// "Grove Bench".  Force it to the package.json "name" so all builds share the
// same data directory as the original Electron Forge build.
app.name = 'grove-bench';
app.setPath('userData', path.join(app.getPath('appData'), 'grove-bench'));

// Register built-in agent adapters before anything else uses them
initAdapters();

registerHandlers();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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

  initAutoUpdater(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Grove Bench started');
}

app.whenReady().then(() => {
  createWindow();

  // Run an initial worktree sweep shortly after launch, then every 15 minutes
  const runSweep = () => {
    worktreeManager.sweepStaleWorktrees().catch((e) => {
      logger.warn('Background worktree sweep failed:', e);
    });
  };
  setTimeout(runSweep, 10_000); // 10s after launch
  const scheduleSweep = () => setTimeout(() => { runSweep(); scheduleSweep(); }, 15 * 60_000);
  scheduleSweep();

  // ─── Power monitor: flush state on suspend, health-check on resume ───
  powerMonitor.on('suspend', () => {
    logger.info('System suspending — flushing pending state saves');
    flushPendingSaves();
  });

  powerMonitor.on('resume', () => {
    logger.info('System resumed — running session health checks');
    sessionManager.healthCheckAll();
    // Notify renderer so it can re-verify subscriptions
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.POWER_RESUME);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Graceful shutdown: destroy all sessions and clean up worktrees
app.on('before-quit', (event) => {
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
        logger.close();
        app.quit();
      }
    })();
  } else {
    logger.close();
  }
});
