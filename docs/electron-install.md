# Electron Install & Auto-Update

> **Status: Implemented.** The auto-update feature has been added to the codebase. See `src/main/auto-updater.ts` and `src/renderer/components/UpdateNotification.svelte`.

## Building the .exe

The project uses electron-builder with NSIS (Windows installer). Configuration is in `electron-builder.yml`.

### Prerequisites

- Icon files are at `src/main/icon.ico` and `src/main/icon.png`

### Commands

| Command | Output |
|---------|--------|
| `npm run build` | Build main, preload, and renderer |
| `npm run dist` | Build + package the NSIS installer into `out/` (unsigned, never publishes) |

Check a local build with `node scripts/smoke-pty.mjs`, which loads node-pty in the packaged app and runs a command in a terminal.

node-pty is not rebuilt for Electron (`npmRebuild: false`): its 1.1.0 prebuilds use Node-API, so they load in any Electron version, and rebuilding from source needs a Visual Studio release that `@electron/node-gyp` recognises.

---

## Auto-Update Feature

Uses `electron-updater` with GitHub Releases as the update feed.

### Packages to Install

```
npm install electron-updater
```

### Files to Create

#### `src/main/auto-updater.ts`

Core auto-update module. Wraps `electron-updater` with:

- `autoDownload = false` — user chooses when to download
- `autoInstallOnAppQuit = true` — installs on next quit if downloaded
- Checks on startup (60s delay) and every 4 hours
- Only runs when `app.isPackaged` (skips in dev mode)
- Forwards all status events to renderer via IPC

```typescript
import { autoUpdater } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import { IPC } from '../shared/types.js';
import { logger } from './logger.js';

let mainWindow: BrowserWindow | null = null;

function sendStatus(status: UpdateStatus) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPDATE_STATUS, status);
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({
      state: 'available',
      info: {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseName: info.releaseName ?? undefined,
        releaseDate: info.releaseDate,
      },
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ state: 'downloading', percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({
      state: 'downloaded',
      info: {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        releaseName: info.releaseName ?? undefined,
        releaseDate: info.releaseDate,
      },
    });
  });

  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error:', err.message);
    sendStatus({ state: 'error', message: err.message });
  });

  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }
}

export function checkForUpdate() { return autoUpdater.checkForUpdates(); }
export function downloadUpdate() { return autoUpdater.downloadUpdate(); }
export function installUpdate() { autoUpdater.quitAndInstall(false, true); }
```

#### `src/renderer/components/UpdateNotification.svelte`

Small pill/badge that appears in the title bar:

- "Update available" — click to download
- "Downloading XX%" — progress indicator
- "Restart to update" — click to quit and install

### Files to Modify

#### `package.json`

Add `repository` field (required by electron-updater's GitHub provider):

```json
"repository": {
  "type": "git",
  "url": "https://github.com/OWNER/grove-bench.git"
}
```

#### `electron-builder.yml`

Publishing is configured in `electron-builder.yml` with the GitHub provider. electron-builder automatically generates `latest.yml` during the build.

#### `vite.main.config.mjs`

Add `electron-updater` to rollup externals:

```js
build: {
  rollupOptions: {
    external: ['electron-updater'],
  },
}
```

#### `src/shared/types.ts`

Add IPC channels and types:

```typescript
// IPC channels
UPDATE_CHECK: 'update:check',
UPDATE_DOWNLOAD: 'update:download',
UPDATE_INSTALL: 'update:install',
UPDATE_STATUS: 'update:status',

// Types
export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseName?: string;
  releaseDate?: string;
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };
```

#### `src/main/ipc.ts`

Add IPC handlers for update check, download, and install.

#### `src/main/preload.ts`

Expose `checkForUpdate()`, `downloadUpdate()`, `installUpdate()`, and `onUpdateStatus()` via contextBridge.

#### `src/main/index.ts`

Call `initAutoUpdater(mainWindow)` after window creation.

#### `src/renderer/components/TitleBar.svelte`

Embed `<UpdateNotification />` next to the "Grove Bench" text.

---

## Release Workflow

1. On a branch, set the new version: `npm version 0.0.0-alpha.3 --no-git-tag-version` (updates `package.json` and `package-lock.json`). Merge it to `main`.
2. Tag that commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag v0.0.0-alpha.3 && git push origin v0.0.0-alpha.3
   ```
3. `.github/workflows/release.yml` then:
   - checks the tag is `v` + the `package.json` version and the commit is on `main` (`scripts/release-check.mjs`)
   - runs the Package workflow: type check, tests, `npm run dist`, the node-pty smoke test
   - creates the GitHub release with generated notes and uploads the installer, its `.blockmap` and `latest.yml`

Versions with a pre-release part (`-alpha.3`, `-beta.1`) are published as GitHub pre-releases; plain `X.Y.Z` versions as full releases. The release is only created once everything has passed, so a failed run leaves nothing to clean up: fix it on `main`, then delete and re-push the tag (`git push --delete origin vX && git tag -d vX`).

`electron-updater` reads `latest.yml` from the release to detect and download updates. Installs of a pre-release version also receive pre-releases (electron-updater turns `allowPrerelease` on when the running version has a pre-release part); installs of a full release only receive full releases.

The Package workflow also runs on pull requests that touch packaging files, every Monday (runner image updates can break packaging with no change here), and on demand from the Actions tab. Its `windows-installer` artifact (kept 7 days) can be installed for testing.

### Code signing

Installers are not signed, so SmartScreen warns on first run. To sign with Azure Trusted Signing, add `win.azureSignOptions` to `electron-builder.yml` and pass `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` to the "Build installer" step in `.github/workflows/package.yml`.

---

## Gotchas

- **Vite externalization**: `electron-updater` must be in `rollupOptions.external` — it has native bindings that can't be bundled
- **NSIS installer**: electron-builder uses NSIS for Windows installers — no Squirrel dependency
- **Dev mode**: `app.isPackaged` guard is critical — `electron-updater` throws errors without a packaged app
- **Tag format**: Use `v` + the `package.json` version. The Release workflow rejects anything else
