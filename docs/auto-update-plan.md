# Auto-update plan

> **Status: Parts 1 and 3 built; Part 2 (release automation) still to do.** Decisions so far:
> - Cover both the in-app updater and release automation.
> - Download updates in the background and prompt to restart.
> - Release weekly.
> - Going stable is decided later.
> - Code signing is not a blocker.
> - Add a 7-day minimum package age for npm installs.
>
> **Built so far:** Part 3 (minimum package age) and Part 1 (in-app updater). Part 1 follows the plan below, with three additions:
> - The pill's old `hsl(var(--primary) / ...)` styles were invalid with the theme's `oklch` colours, so it showed with no background. It now uses Tailwind colour classes.
> - A second restart request is ignored. Calling `quitAndInstall` twice makes electron-updater's quit hook start the installer again.
> - Settings links to all releases rather than one release page.

## Where things stand

The in-app updater already exists and has shipped:

- `src/main/auto-updater.ts` wraps `electron-updater` with the GitHub Releases feed configured in `electron-builder.yml` (`publish:`).
- `src/renderer/components/UpdateNotification.svelte` shows a title bar pill: "Update vX available" (click to download), "Downloading N%", "Restart to update".
- Both published releases, `v0.0.0-alpha.1` and `v0.0.0-alpha.2`, contain it. The only difference from alpha.2 is the first check delay (10s then, 60s now).
- The Release workflow uploads the installer, its `.blockmap` and `latest.yml`, and the repo is public, so the feed needs no token.

**The main reason nobody gets updates is that nothing has been released.** The last release is `v0.0.0-alpha.2` (1 April 2026) and `package.json` is still `0.0.0-alpha.2`. Everything merged since then has not reached an installed app.

## Problems found

Checked against the versions in `package-lock.json`: electron-updater 6.8.3, app-builder-lib 26.8.1.

1. **Nothing downloads on its own.** `autoDownload = false` (`src/main/auto-updater.ts:27`).
2. **"Restart to update" can cut off quit cleanup.** `installUpdate()` calls `quitAndInstall` (`auto-updater.ts:78`), which starts the installer and then calls `app.quit()` (electron-updater `BaseUpdater.quitAndInstall`). Our `before-quit` handler (`src/main/index.ts:168`) then starts async cleanup: kill terminals, stop agents, remove worktrees. At the same time, the installer runs with `--updated`, waits about a second, then stops every process running from the install folder, forcing it if needed (`_CHECK_APP_RUNNING` in app-builder-lib `templates/nsis/include/allowOnlyOneInstallerInstance.nsh`). So cleanup has a few seconds at most. The install-on-quit path is safe, because it waits for Electron's `quit` event, which fires after cleanup (`ElectronAppAdapter.onQuit`).
3. **Errors are invisible.** They are logged (`auto-updater.ts:50`) and sent as `state: 'error'`, but the pill has no error state, so it just disappears.
4. **The check result can't cross IPC once auto-download is on.** `checkForUpdates()` returns `{ cancellationToken, downloadPromise }`, and `downloadPromise` is a real Promise when `autoDownload` is true (`AppUpdater.js:421-422`). Returning that from `ipcMain.handle` will fail to serialise. The declared type is also wrong (`checkForUpdate(): Promise<void>`, `src/shared/types.ts:973`). Nothing in the UI calls it today, so this has not shown up yet.
5. **Missing basics.** The app version is not shown anywhere, there is no "Check for updates" button, no release notes link, no tests, and electron-updater's own log goes nowhere (no `autoUpdater.logger`).
6. **State is lost on renderer reload.** Status is push-only, so a reloaded window forgets an already downloaded update until the next check (up to 4 hours).

Things that already work and should stay:

- **Pre-release following.** A running pre-release version turns `allowPrerelease` on (`AppUpdater.js:218`). For an `alpha` install, `GitHubProvider.getLatestVersion` takes the newest alpha, beta or stable entry in `releases.atom`. It then tries `alpha.yml` and falls back to `latest.yml`. A stable install uses `/releases/latest`, which skips pre-releases.
- **Unsigned updates.** Unsigned updates install because `app-update.yml` has no `publisherName`, so `NsisUpdater.verifySignature` has nothing to check against. Once signing is added, updates will start being verified automatically.
- **Differential downloads.** They use the uploaded `.blockmap` (`disableDifferentialDownload` defaults to false, `AppUpdater.js:153`). This matters with a ~110 MB installer.

## Part 1: in-app updater (implemented)

### Behaviour

- Check 60s after start, then every 4 hours (unchanged).
- If "Download updates automatically" is on (default), download in the background with no UI.
- When the download finishes, show the pill "Restart to update". Leaving it alone is fine: the update installs silently the next time the app quits (`autoInstallOnAppQuit`, already on).
- Clicking the pill:
  - If any conversation is mid-turn, confirm first: "2 conversations are still working. Restarting will stop them."
  - Then run the normal quit cleanup to completion.
  - Then install silently and relaunch.
- If the setting is off, keep today's flow: "Update vX available" pill, click to download.
- Background check errors (usually just offline) are not shown in the title bar. Download errors and errors from a manual check are shown ("Update failed, retry").

### Changes

**`src/main/index.ts`**
- Move the body of the `before-quit` handler into `shutdown(): Promise<void>`. Make it idempotent: it keeps one promise and sets `isQuitting`.
- `before-quit` calls `shutdown()` then `app.quit()`, as it does now.
- Pass `shutdown` to `initAutoUpdater`.

**`src/main/auto-updater.ts`**
- `autoDownload` follows the new setting. Apply it at start and whenever settings are saved.
- `autoUpdater.logger` writes to our `logger` (electron-updater accepts any `{ info, warn, error }`).
- Keep `lastStatus`, and add `getUpdateState(): { currentVersion: string; status: UpdateStatus | null }`.
- `checkForUpdate()` returns plain data: `{ available: boolean; version?: string }`.
- `restartToUpdate()`: `await shutdown()`, then `autoUpdater.quitAndInstall(true, true)` (silent, relaunch). `before-quit` then sees `isQuitting` and lets the quit through. electron-updater's own quit hook skips because `quitAndInstallCalled` is set.
- Tag errors with where they came from: `{ state: 'error'; message: string; during: 'check' | 'download'; manual: boolean }`.
- Register the `autoUpdater` listeners once, not per window.

**`src/shared/types.ts`, `src/main/preload.ts`, `src/main/ipc.ts`**
- Add setting `autoDownloadUpdates: boolean` (default `true`) to `GroveBenchSettings` and the settings defaults.
- New IPC `update:get-state`.
- Fix the `checkForUpdate` return type.
- Rename the install call to `restartToUpdate` to match what it does.

**`src/renderer/components/UpdateNotification.svelte`**
- On mount, load the state from `getUpdateState()`, then subscribe to updates.
- Pill states: available (manual mode only), downloading (manual mode only), downloaded, error (download or manual only).
- Add a confirm step when conversations are running (read from the sessions store).
- Add a "What's new" link to `https://github.com/ParsonsProjects/grove-bench/releases/tag/v<version>` through the existing `openExternal`. Don't render the feed's HTML release notes in the app.

**`src/renderer/components/SettingsPanel.svelte`** (General tab), new "Updates" group:
- "Version 0.x.y"
- "Check for updates" button with an inline result ("You're up to date" / "Downloading 0.x.y" / error)
- "Download updates automatically" toggle
- "Release notes" link

**Docs and mocks**
- `docs/help/settings.md`: add an Updates section, using "conversation" wording.
- `src/renderer/demo-mock.ts` and `src/renderer/__mocks__/setup.ts`: add the new API calls.

### Tests

- `src/main/auto-updater.test.ts` (mock `electron-updater`):
  - `autoDownload` follows the setting and changes when settings change.
  - `restartToUpdate` awaits `shutdown` before `quitAndInstall(true, true)`.
  - `getUpdateState` returns the last status.
  - Nothing runs when `app.isPackaged` is false.
  - `checkForUpdate` returns plain data.
- `src/renderer/components/UpdateNotification.svelte.test.ts`:
  - Each pill state renders.
  - Errors from background checks stay hidden.
  - Confirm shows only when a conversation is running.
- Manual check on Windows before the first automatic release:
  1. Install release N from the Actions artifact.
  2. Publish N+1.
  3. Confirm the background download, the restart path (cleanup log lines appear before the installer runs), install-on-quit, the relaunch, and that the install folder is unchanged after a silent update.

## Part 2: release automation

### Constraints

- **`main` is protected**, so a workflow can't push a version bump commit to it with `GITHUB_TOKEN`.
- **Anything done with `GITHUB_TOKEN` does not start other workflows.** Quoted in the release-please-action README: "events triggered by the `GITHUB_TOKEN` will not create a new workflow run". So a tag or PR created by a bot won't trigger the Release workflow or CI.
- **Merges come in bursts.** Up to 8 a day (8 on both 18 and 27 Sep 2026). Releasing on every merge would mean several restart prompts a day.
- **Commit titles are mostly not conventional commits.** 9 of the last 45 merges use them. Tools that pick the version from commit types (release-please, semantic-release) would miss most changes.

### Recommended design: weekly pre-release when `main` has changed

The release version is worked out in CI and stamped into the build. `package.json` on `main` becomes the floor version, not the exact released one. That is the trade-off for not needing a bot commit or a personal access token.

**Version rule** (`scripts/next-version.mjs`, a pure function plus a small CLI wrapper):

1. `last` = highest semver among the `v*` tags. `base` = the `package.json` version.
2. If `base > last`: release `base`. This is how you start a new series or ship a stable version: bump `package.json` in a normal PR.
3. Else, if no shipped file changed since `last`: skip. Shipped files are `src/`, `package.json`, `package-lock.json`, `electron-builder.yml` and `vite.*.config.mjs`.
4. Else, if `last` is a pre-release: release `semver.inc(last, 'prerelease')`, for example `0.0.0-alpha.2` to `0.0.0-alpha.3`.
5. Else (`last` is stable): skip. Stable releases stay a deliberate bump.

Pre-release numbers compare numerically (`alpha.10 > alpha.9`), per SemVer 2.0.0 section 11, so long alpha runs sort correctly.

**`.github/workflows/release.yml`**
- Triggers:
  - `schedule`: weekly, for example Tuesday 05:23 UTC (`'23 5 * * 2'`). This is a different day from the Monday Package run (`'17 6 * * 1'`).
  - `workflow_dispatch` ("release now", optional `version` override).
  - `push` to `main` touching `package.json`. For push runs, only rule 2 can release, so dependency bumps don't cut releases.
  - Drop the tag-push trigger.
- The `check` job runs `next-version.mjs`, then outputs `version`, `prerelease` and `skip`.
- Add a pause switch: skip when the repo variable `AUTO_RELEASE` is `off`.
- `publish` runs `gh release create "v$VERSION" out/* --target "$GITHUB_SHA" --title "$VERSION" --generate-notes [--prerelease]`, without `--verify-tag`. This creates the tag at the built commit. gh uploads assets while the release is still a draft and publishes afterwards, so clients never see a release without `latest.yml` (cli/cli `pkg/cmd/release/create/create.go`, `draftWhileUploading`).
- `--generate-notes` builds notes from merged PR titles, so it does not care about commit title style.

**`.github/workflows/package.yml`**
- Add a `workflow_call` input `version`.
- Before `npm run dist`, run `npm version "$VERSION" --no-git-tag-version --allow-same-version`. The installer name, `latest.yml` and `app.getVersion()` all read from `package.json`, so they stay in line.

**Scripts and docs**
- `scripts/release-check.mjs`: replace with `next-version.mjs`. Keep the semver validation, and drop "tag must equal package.json".
- Add `scripts/**/*.test.mjs` to the `main` project in `vitest.config.mts`, and test the version rule: every branch above, plus alpha.9 to alpha.10.
- `docs/electron-install.md`: rewrite "Release Workflow" (weekly, manual bump, pause switch, "release now").

### Alternatives considered

- **release-please.** It needs conventional PR titles (a title lint check) plus a PAT or GitHub App token, so its PRs get CI and its releases trigger the build. Worth revisiting if the titles get linted, because it gives a reviewable release PR and a changelog file.
- **A release on every merge.** Too many restart prompts (see the burst numbers above).
- **A workflow that bumps and pushes to `main`.** Blocked by branch protection.

## Part 3: minimum package age (`.npmrc`) (implemented)

**Goal:** don't install a package version until it has been public for 7 days. A hijacked release is usually spotted and pulled within that time.

### What npm does (tested)

Tested on 28 Sep 2026 with `@types/node` 26.6.3, which was published 3 days earlier. The previous version, 26.6.2, was 9 days old.

| Setup | Result |
|---|---|
| npm 11.20.0, `min-release-age=7`, `npm install @types/node@^26` | Installed 26.6.2, skipping the 3-day-old version |
| Same with npm 10.9.7 | Installed 26.6.3 with no warning: older npm ignores the setting |
| Lockfile already pins 26.6.3, setting on, `npm ci` | Installed 26.6.3, exit code 0 |
| Same, `npm install` with no arguments | Kept 26.6.3 |
| Root `.npmrc` only, install inside a nested package (like `landing/`) | Installed 26.6.3: the root file doesn't apply there |
| `engine-strict=true` and `"engines": { "npm": ">=11.10.0" }`, npm 10.9.7 | `npm install` and `npm ci` both stop with `notsup` |

Other facts:
- **First supported version.** `min-release-age` (in days) first appears in npm 11.10.0, released 11 Feb 2026. It is in the config definitions of the 11.10.0 tarball but not 11.9.0.
- **How it works.** It sets npm's `before` date to now minus N days.
- **CI already supports it.** Node 24 bundles npm 11.19.0 (`deps/npm/package.json` on the `nodejs/node` `v24.x` branch), and every workflow uses `node-version: 24`.

**The takeaway:** the setting only applies when npm picks a version, which happens when you add a package, run `npm update`, or rebuild the lockfile. Anything already in `package-lock.json` installs whatever its age.

### Changes

- `.npmrc` at the root and `landing/.npmrc`:
  ```ini
  min-release-age=7
  engine-strict=true
  ```
- `package.json` and `landing/package.json`: add `"engines": { "npm": ">=11.10.0" }`. An older npm then stops with an error instead of quietly skipping the check.
- **`engine-strict` side effect.** It also turns every dependency's `engines` warning into an error. Checked today:
  - All 467 entries with `engines` in `package-lock.json` accept Node 22.22.2, 24.19.0 and 24.21.0.
  - All 98 such entries in `landing/package-lock.json` do too.
- **Lockfile check in CI**, to close the gap above: `scripts/check-release-age.mjs`, run by `ci.yml` on PRs that change a `package-lock.json`.
  - It lists entries added or changed since the base branch.
  - It reads each version's publish time from the registry (`time[version]` in the full package document).
  - It fails if any of them is less than 7 days old.
  - This also catches lockfile changes made with an old npm, or by tools that don't read `.npmrc`.
- `CLAUDE.md`: add `.npmrc` to "Config Files".

### Side effects and exceptions

- **Urgent security fixes.** If a fix was published less than 7 days ago, `npm audit fix` keeps the vulnerable version, warns and exits non-zero (from npm's own description of the setting). To allow one package, add `min-release-age-exclude[]=<name>` to `.npmrc`. For a one-off install, use `npm install <pkg>@<version> --min-release-age=0` (command-line settings win over the project `.npmrc`). The CI check should read the same exclude list from `.npmrc`.
- **Brand-new packages.** Adding a package whose only versions are under 7 days old fails. Wait, or exclude it.
- **Every machine needs npm 11.10.0 or later.** This cloud environment has npm 10.9.7 (Node 22.22.2), so `npm ci` will fail here once this lands. Add `npm install -g npm@11` to the environment's setup script (cloud environment menu in the session title bar, then Edit, then Setup script). Do the same on your Windows machine if `npm -v` shows less than 11.10.0. npm 11 supports Node `^20.17.0 || >=22.9.0`.

## Rollout

1. **PR 1: minimum package age** (Part 3). Small and independent.
2. **PR 2: in-app updater** (Part 1). Ship it in a normal release, so the safer restart reaches installed apps before automatic releases start.
3. **PR 3: release automation** (Part 2). After it merges, the next weekly run produces `0.0.0-alpha.3`, or you can run "release now" straight away.
4. **The first update from alpha.2 uses the old code**, so the restart problem still applies for that one update. To avoid it, click "download", then quit the app instead of clicking "Restart to update". Install on quit is safe (see problem 2). The alpha.2 installer shows 1 download on GitHub, so this likely only affects you.

## Open questions

- **Moving to stable.** You'll decide later. Until then, every release is an alpha pre-release. After the switch, stable installs only get deliberate version bumps.
- **Code signing.** Not a blocker. It can be added at any time. Once it is, electron-updater starts checking update signatures, so every later release must be signed by the same publisher.

## Sources

- electron-updater 6.8.3 (npm tarball): `out/AppUpdater.js`, `out/BaseUpdater.js`, `out/NsisUpdater.js`, `out/ElectronAppAdapter.js`, `out/providers/GitHubProvider.js`
- app-builder-lib 26.8.1 (npm tarball): `templates/nsis/include/allowOnlyOneInstallerInstance.nsh`, `templates/nsis/assistedInstaller.nsh`
- GitHub CLI source, `pkg/cmd/release/create/create.go`: https://github.com/cli/cli/blob/trunk/pkg/cmd/release/create/create.go
- release-please-action README: https://github.com/googleapis/release-please-action
- Semantic Versioning 2.0.0, section 11: https://semver.org/#spec-item-11
- GitHub releases for this repo: https://github.com/ParsonsProjects/grove-bench/releases
- npm 11.9.0, 11.10.0, 11.20.0 and 12.1.0 (npm tarballs): `node_modules/@npmcli/config/lib/definitions/definitions.js` (`min-release-age`, `min-release-age-exclude`, `before`). Release dates from `npm view npm time`.
- Node 24 bundled npm version: https://github.com/nodejs/node/blob/v24.x/deps/npm/package.json
