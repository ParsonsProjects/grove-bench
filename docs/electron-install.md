# Electron Install & Auto-Update

> **Status: Not yet implemented.** This document is a plan for the auto-update feature. The building/packaging section below is accurate, but the auto-updater code has not been added to the codebase yet.

## Building the .exe

The project uses Electron Forge with MakerSquirrel (Windows installer) and MakerZIP (portable zip).

### Prerequisites

- Ensure `extraResource` files exist in `forge.config.mjs`, or remove the entry if not needed
- Icon files are at `src/main/icon.ico` and `src/main/icon.png`

### Commands

| Command | Output |
|---------|--------|
| `npm run package` | Raw packaged app directory with `.exe` at `out/grove-bench-win32-x64/grove-bench.exe` |
| `npm run make` | Squirrel installer at `out/make/squirrel.windows/x64/grove-bench-X.Y.Z Setup.exe` + portable zip at `out/make/zip/win32/x64/` |
| `npx electron-forge publish` | Builds, then uploads assets to a draft GitHub Release |

---

## Auto-Update Feature

Uses `electron-updater` with GitHub Releases as the update feed.

### Packages to Install

```
npm install electron-updater
npm install -D @electron-forge/publisher-github
```

### Files to Create

#### `src/main/auto-updater.ts`

Core auto-update module. Wraps `electron-updater` with:

- `autoDownload = false` — user chooses when to download
- `autoInstallOnAppQuit = true` — installs on next quit if downloaded
- Checks on startup (10s delay) and every 4 hours
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

#### `forge.config.mjs`

Add publisher and `postMake` hook to generate `latest.yml`:

```js
import { PublisherGithub } from '@electron-forge/publisher-github';

// Add to config:
publishers: [
  new PublisherGithub({
    repository: { owner: 'OWNER', name: 'grove-bench' },
    prerelease: false,
    draft: true,
  }),
],
hooks: {
  postMake: async (forgeConfig, makeResults) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const crypto = await import('node:crypto');

    for (const result of makeResults) {
      if (result.platform === 'win32') {
        for (const artifact of result.artifacts) {
          if (artifact.endsWith('.exe')) {
            const stat = await fs.stat(artifact);
            const fileBuffer = await fs.readFile(artifact);
            const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
            const fileName = path.basename(artifact);
            const version = result.packageJSON.version;

            const latestYml = [
              `version: ${version}`,
              `files:`,
              `  - url: ${fileName}`,
              `    sha512: ${sha512}`,
              `    size: ${stat.size}`,
              `path: ${fileName}`,
              `sha512: ${sha512}`,
              `releaseDate: '${new Date().toISOString()}'`,
            ].join('\n');

            const ymlPath = path.join(path.dirname(artifact), 'latest.yml');
            await fs.writeFile(ymlPath, latestYml);
            result.artifacts.push(ymlPath);
          }
        }
      }
    }
    return makeResults;
  },
},
```

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

1. Bump version in `package.json`
2. Commit and tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Build and publish: `npx electron-forge publish`
4. Verify the draft release on GitHub
5. Publish the release (un-draft it)

`electron-updater` reads the `latest.yml` from the GitHub Release to detect new versions and download the update.

---

## Gotchas

- **Vite externalization**: `electron-updater` must be in `rollupOptions.external` — it has native bindings that can't be bundled
- **Squirrel startup**: Existing `electron-squirrel-startup` handler stays — no conflict with `electron-updater`
- **Code signing**: Unsigned apps show SmartScreen warnings. Recommended for production
- **Dev mode**: `app.isPackaged` guard is critical — `electron-updater` throws errors without a packaged app
- **Tag format**: Use `vX.Y.Z` — `electron-updater` strips the `v` prefix automatically
