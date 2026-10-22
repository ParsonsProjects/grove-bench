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

`.github/workflows/release.yml` publishes `main` as a GitHub release, tagged `v<version>`. It runs:

- **Every Tuesday** (05:23 UTC), if anything that ships has changed since the last release: `src/` (not tests or mocks), `docs/help/`, `index.html`, `package.json`, `package-lock.json`, `electron-builder.yml`, the Vite and Svelte configs, `tsconfig.json` and `scripts/vite-csp.mjs`.
- **When a push to `main` raises the `package.json` version.** Other `package.json` changes, such as dependency updates, don't release.
- **From the Actions tab** (Release, then **Run workflow** on `main`). Leave the version empty to release the next one now, or name one, such as `1.0.0`.

`scripts/release-check.mjs` picks the version (`scripts/next-version.mjs`):

1. A version named in **Run workflow**, if it is higher than the last release.
2. The `package.json` version, if it is higher than the last release (the highest `v*` tag).
3. Otherwise the last release plus one, if it is a pre-release: `0.0.0-alpha.9` to `0.0.0-alpha.10`. After a full version, nothing is released until you raise `package.json` or name a version.

So `package.json` on `main` is the lowest version to release next, not the released one. The Package workflow writes the picked version into `package.json` before it builds (`npm version --no-git-tag-version`), so the installer name, `latest.yml` and the app's version match the release. To start a new series or release a full version, raise `package.json` in a normal PR: `npm version 0.1.0-alpha.1 --no-git-tag-version` (updates `package.json` and `package-lock.json`). Merging it releases that version.

Each run then builds and smoke tests the installer (the Package workflow: type check, tests, `npm run dist`, the smoke tests) and creates the GitHub release with generated notes, the installer, its `.blockmap` and `latest.yml`. The release and its tag are only created once everything has passed, so a failed run leaves nothing to clean up: fix it on `main`, then run the workflow again. Don't push `v*` tags by hand: the next run counts the highest tag as the last release, released or not.

To pause releases (say, while `main` is broken), set the repository variable `AUTO_RELEASE` to `off` (Settings, Secrets and variables, Actions, Variables). Scheduled and push runs then do nothing; runs started from the Actions tab still release.

Plain `X.Y.Z` versions are published as full releases. Versions with a pre-release part (`-alpha.3`, `-beta.1`) are published as GitHub pre-releases once a plain version has a published full release (`scripts/release-type.mjs`). Until then they are full releases too: GitHub's "Latest" badge skips pre-releases, so it would otherwise stay on an old build and people would download that.

`electron-updater` reads `latest.yml` from the release to detect and download updates. Installs of a pre-release version also receive pre-releases (electron-updater turns `allowPrerelease` on when the running version has a pre-release part); installs of a full version only receive full releases.

The Package workflow also runs on pull requests that touch packaging files, every Monday (runner image updates can break packaging with no change here), and on demand from the Actions tab. Its `windows-installer` artifact (kept 7 days) can be installed for testing.

### Code signing

Installers are not signed. Windows SmartScreen warns on first run, and antivirus tools can flag the installer too: AVG did in October 2026. Signing was looked at then and left for later. The options for a UK developer:

| Route | Who can use it | Notes |
|---|---|---|
| Azure Artifact Signing (was Trusted Signing) | Organisations in the UK, EU, US and some other countries; individual developers only in the US and Canada ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [Windows code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)) | Signs in CI. electron-builder supports it as `win.azureSignOptions` ([electron-builder docs](https://www.electron.build/docs/features/code-signing/code-signing-win)) |
| OV or individual-validated certificate from a certificate authority | Individuals, in the UK too | The key has to live on hardware or the authority's cloud service, so CI signs through that service (SSL.com's eSigner, for example: [SSL.com OV code signing](https://www.ssl.com/products/software-integrity/code-signing/ov/)) |
| SignPath Foundation (free) | Projects under an OSI-approved licence ([conditions](https://signpath.org/terms)) | Not open to Grove: FSL-1.1-MIT is not OSI approved |

Signing doesn't guarantee a clean first run: SmartScreen also weighs the file's own reputation, so a new signed installer can still get a warning ([Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/microsoftthreatprotection/smartscreen-reputation-issue-for-ev-code-signed-windows-application/4537122/replies/4538443)).

To add Azure signing later: add `win.azureSignOptions` (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`) to `electron-builder.yml` and pass `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` to the "Build installer" step in `.github/workflows/package.yml`. `publisherName` must match the certificate's subject exactly: it goes into `app-update.yml`, and from then on electron-updater installs only updates signed by that publisher. Installs made before signing have no publisher to check, so they take the first signed update (`docs/auto-update-plan.md`).

### Antivirus false positives

Until the installer is signed and has a reputation, check each release, and report any detection:

1. Upload the installer to [VirusTotal](https://www.virustotal.com) to see which engines flag it, and keep the link.
2. Report it on the vendor's false positive form with the installer (or its release link), the detection name, the VirusTotal link and the project page. Avast: `https://www.avast.com/false-positive-file-form.php`. AVG: `https://www.avg.com/en-us/false-positive-file-form`. These addresses come from third-party lists ([MajorGeeks](https://www.majorgeeks.com/content/page/how_to_help_small_authors_report_false_positives.html), [AV-Comparatives](https://av-comparatives.org/dealing-with-false-positives-reporting-issues-to-antivirus-vendors/)); check the form is still there.
3. For SmartScreen and Microsoft Defender, submit it as a software developer at [microsoft.com/wdsi/filesubmission](https://www.microsoft.com/wdsi/filesubmission) ([submission guide](https://learn.microsoft.com/en-us/defender-xdr/submission-guide)).

---

## Gotchas

- **Vite externalization**: `electron-updater` must be in `rollupOptions.external` — it has native bindings that can't be bundled
- **NSIS installer**: electron-builder uses NSIS for Windows installers — no Squirrel dependency
- **Dev mode**: `app.isPackaged` guard is critical — `electron-updater` throws errors without a packaged app
- **Tags**: The Release workflow creates the `v<version>` tags. Pushing one by hand makes no release, and the next run counts it as the last release
