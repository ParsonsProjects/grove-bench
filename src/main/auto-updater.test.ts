import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { app, type BrowserWindow } from 'electron';
import type { UpdateStatus } from '../shared/types.js';

type Handler = (...args: unknown[]) => void;

const { updater, settings } = vi.hoisted(() => {
  const handlers = new Map<string, Handler[]>();
  return {
    settings: { autoDownloadUpdates: true },
    updater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      logger: null as unknown,
      handlers,
      on(event: string, fn: Handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      },
      emit(event: string, ...args: unknown[]) {
        for (const fn of handlers.get(event) ?? []) fn(...args);
      },
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    },
  };
});

vi.mock('electron-updater', () => ({ autoUpdater: updater }));
vi.mock('./settings.js', () => ({ getSettings: () => settings }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Updater = typeof import('./auto-updater.js');

const appMock = app as unknown as { isPackaged: boolean; getVersion: () => string };
const RELEASE = { version: '1.2.0', releaseName: '1.2.0', releaseDate: '2026-10-01T00:00:00Z' };
const INFO = { version: '1.2.0', releaseNotes: undefined, releaseName: '1.2.0', releaseDate: '2026-10-01T00:00:00Z' };

let mod: Updater;
let win: { webContents: { send: ReturnType<typeof vi.fn> }; isDestroyed: () => boolean; on: ReturnType<typeof vi.fn> };
let shutdown: ReturnType<typeof vi.fn<() => Promise<void>>>;

/** Statuses sent to the window, in order. */
function sent(): UpdateStatus[] {
  return win.webContents.send.mock.calls.map(([, status]) => status as UpdateStatus);
}

/** Make the next checkForUpdates() emit these events, then resolve. */
function nextCheck(events: Array<[string, unknown?]>) {
  updater.checkForUpdates.mockImplementationOnce(async () => {
    for (const [event, arg] of events) updater.emit(event, arg);
    return {};
  });
}

async function init(opts: { packaged?: boolean; autoDownload?: boolean } = {}) {
  appMock.isPackaged = opts.packaged ?? true;
  settings.autoDownloadUpdates = opts.autoDownload ?? true;
  mod = await import('./auto-updater.js');
  mod.initAutoUpdater(win as unknown as BrowserWindow, { shutdown });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  updater.handlers.clear();
  updater.checkForUpdates.mockReset();
  updater.downloadUpdate.mockReset().mockResolvedValue([]);
  updater.quitAndInstall.mockReset();
  win = { webContents: { send: vi.fn() }, isDestroyed: () => false, on: vi.fn() };
  shutdown = vi.fn(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
  appMock.isPackaged = false;
});

describe('auto-updater', () => {
  it('follows the automatic download setting', async () => {
    await init({ autoDownload: false });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    mod.applyUpdateSettings({ autoDownloadUpdates: true });
    expect(updater.autoDownload).toBe(true);
  });

  it('runs the first check after a minute, quietly, and downloads what it finds', async () => {
    await init();
    // The download carries on after the check and rejects if it fails. The
    // module must catch it, or the test run reports an unhandled rejection.
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('checking-for-update');
      updater.emit('update-available', RELEASE);
      return { downloadPromise: new Promise((_, reject) => setTimeout(() => reject(new Error('connection reset')), 5_000)) };
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([{ state: 'downloading', info: INFO, percent: 0, manual: false }]);
    await vi.advanceTimersByTimeAsync(5_000);
  });

  it('reports a manual check as it goes and resolves to the result', async () => {
    await init();
    nextCheck([['checking-for-update'], ['update-not-available', RELEASE]]);

    await expect(mod.checkForUpdate()).resolves.toEqual({ state: 'not-available', manual: true });
    expect(sent()).toEqual([
      { state: 'checking', manual: true },
      { state: 'not-available', manual: true },
    ]);
  });

  it('with automatic download off, waits for a click and then shows the download', async () => {
    await init({ autoDownload: false });
    nextCheck([['checking-for-update'], ['update-available', RELEASE]]);
    await mod.checkForUpdate();
    expect(mod.getUpdateState().status).toEqual({ state: 'available', info: INFO });

    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('download-progress', { percent: 50 });
      updater.emit('update-downloaded', RELEASE);
      return [];
    });
    await mod.downloadUpdate();

    expect(sent().slice(-3)).toEqual([
      { state: 'downloading', info: INFO, percent: 0, manual: true },
      { state: 'downloading', info: INFO, percent: 50, manual: true },
      { state: 'downloaded', info: INFO },
    ]);
  });

  it('says whether an error came from the check or the download, and who asked', async () => {
    await init();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('checking-for-update');
      updater.emit('error', new Error('offline'));
      throw new Error('offline');
    });
    await expect(mod.checkForUpdate()).resolves.toEqual({ state: 'error', message: 'offline', during: 'check', manual: true });

    nextCheck([['checking-for-update'], ['update-available', RELEASE], ['error', new Error('disk full')]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mod.getUpdateState().status).toEqual({ state: 'error', message: 'disk full', during: 'download', manual: false });
  });

  it('starts the download when automatic download is turned on with an update waiting', async () => {
    await init({ autoDownload: false });
    nextCheck([['checking-for-update'], ['update-available', RELEASE]]);
    await mod.checkForUpdate();

    mod.applyUpdateSettings({ autoDownloadUpdates: true });

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(mod.getUpdateState().status).toEqual({ state: 'downloading', info: INFO, percent: 0, manual: false });
  });

  it('stops background checks once an update is downloaded, but still checks on request', async () => {
    await init();
    nextCheck([['checking-for-update'], ['update-available', RELEASE], ['update-downloaded', RELEASE]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mod.getUpdateState().status).toEqual({ state: 'downloaded', info: INFO });

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    nextCheck([['checking-for-update'], ['update-available', RELEASE], ['update-downloaded', RELEASE]]);
    await mod.checkForUpdate();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('restarts only after shutdown has finished, then installs silently and reopens', async () => {
    let finishShutdown!: () => void;
    shutdown.mockImplementation(() => new Promise<void>((resolve) => { finishShutdown = resolve; }));
    await init();
    nextCheck([['checking-for-update'], ['update-available', RELEASE], ['update-downloaded', RELEASE]]);
    await mod.checkForUpdate();

    const restarting = mod.restartToUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    finishShutdown();
    await restarting;
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('ignores a second restart request', async () => {
    await init();
    nextCheck([['checking-for-update'], ['update-available', RELEASE], ['update-downloaded', RELEASE]]);
    await mod.checkForUpdate();

    await Promise.all([mod.restartToUpdate(), mod.restartToUpdate()]);
    await mod.restartToUpdate();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('does not restart before an update is downloaded', async () => {
    await init();
    await mod.restartToUpdate();
    expect(shutdown).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does nothing in a dev build', async () => {
    await init({ packaged: false });
    await expect(mod.checkForUpdate()).resolves.toBeNull();
    await mod.downloadUpdate();
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(mod.getUpdateState()).toEqual({ currentVersion: appMock.getVersion(), enabled: false, status: null });
  });
});
