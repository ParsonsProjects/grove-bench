# Electron Install & Auto-Update

> **Status: Implemented.** See "Auto-Update Feature" below for how it works.

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

Uses `electron-updater` with GitHub Releases as the update feed (`publish:` in `electron-builder.yml`). The plan and the reasons behind it are in `docs/auto-update-plan.md`.

- **`src/main/auto-updater.ts`** checks 60s after start, then every 4 hours, only in the installed app (`app.isPackaged`). With the **Download updates automatically** setting on (the default, `autoDownloadUpdates`), a new version downloads in the background. A downloaded update installs when the app quits (`autoInstallOnAppQuit`). Every status goes to the renderer on `update:status`, marked `manual` when the user asked for it, so background work stays quiet. Background checks stop once an update is downloaded. electron-updater's own log goes to the app log with an `[updater]` prefix.
- **Restart to update** (`restartToUpdate()`) first runs the same shutdown as quitting (`shutdown()` in `src/main/index.ts`: stop every agent and shell), then calls `quitAndInstall(true, true)`: a silent install that reopens the app. The order matters: during an update, the NSIS installer stops every process still running from the install folder a second or two after it starts (`_CHECK_APP_RUNNING` in electron-builder's `allowOnlyOneInstallerInstance.nsh`).
- **`src/renderer/components/UpdateNotification.svelte`** is the title bar pill. "Update vX available" (click to download) appears only with automatic download off. "Downloading N%" appears only for a download you started. "Restart to update" (with a **What's new** link) appears once an update is ready, and asks first if conversations are still working. "Update failed, retry" appears for a failed download or a failed check you asked for.
- **`src/renderer/components/UpdateSettings.svelte`** is the Updates group in Settings > General: version, **Check for updates**, and the automatic download option.

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
