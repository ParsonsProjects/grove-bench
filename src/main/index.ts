import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerHandlers } from './ipc.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { loadWindowState, trackWindowState } from './window-state.js';
import * as settings from './settings.js';
import { logger } from './logger.js';
import { IPC } from '../shared/types.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import electronSquirrelStartup from 'electron-squirrel-startup';
if (electronSquirrelStartup) app.quit();

registerHandlers();

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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
