# Electron upgrade plan

> **Status: Plan, not started.** Recommendation:
> - Move to Electron 44.9.x in one jump, on or after 28 Oct 2026 (44.9.3, or at least 44.9.1).
> - Move to 45 in a second PR, once 45 has had a few patch releases and well before 46 ships.
>
> Checked on 25 Oct 2026, against the lockfile's Electron 33.3.2.

## Where things stand

- `package.json` asks for `"electron": "~33.3.1"`. The lockfile has 33.3.2, which bundles Chromium 130.0.6723.191 and Node 20.18.1.
- The 33 line is over. Its last release was 33.4.11, on 26 Apr 2025.
- Electron supports the latest 3 stable majors. Since 45.0.0 (21 Oct 2026), those are 45, 44 and 43. Only the newest minor of each line gets fixes.
- `npm audit` lists 46 advisories against 33.3.2: 25 moderate, 12 high, 9 low. 33.4.11 is inside all 46 ranges, so a 33.x bump fixes nothing.

## Which version

`min-release-age=7` and the Dependency age workflow only allow versions 7 days old or more.

| Version | Published (UTC) | Allowed from | Chromium | Node | Notes |
|---|---|---|---|---|---|
| 44.9.0 | 17 Oct, 05:50 | now | 152.0.7977.167 | 24.22.0 | Still has GHSA-jr5w-w6x2-84p9 (high) |
| 44.9.1 | 20 Oct, 02:53 | 27 Oct | not checked | not checked | Fixes GHSA-jr5w-w6x2-84p9 |
| 44.9.3 | 21 Oct, 03:31 | 28 Oct | 152.0.7977.167 | 24.22.0 | Newest 44 today |
| 45.0.0 | 21 Oct, 06:03 | 28 Oct | 156.0.8078.48 | 24.22.0 | Only 45 release so far |

**Recommended: 44.9.3 (never below 44.9.1).** Why:

- **It fixes every advisory.** npm audit names 45.0.0, but the advisory ranges say 44.9.1 and later are clear of all 46 too. One of the 46, GHSA-jr5w-w6x2-84p9, also covers 44.0.0 to 44.9.0, which is why 44.9.0 is not enough.
- **Same Node as 45.** 44.9.3 and 45.0.0 both bundle Node 24.22.0, so 45 adds nothing on the Node side.
- **44 has settled.** It has had 22 releases since 25 Aug 2026. 45.0.0 is four days old, and 42, 43 and 44 each had 2 to 4 more releases in the three weeks after their .0.
- **45 needs more code changes.** It changes the trace file format and deprecates the sync `safeStorage` calls (both below). 44 only needs small fixes.

The cost is a shorter support window. 44 stops getting fixes when 47 ships, one major before 45 does. Electron's breaking-changes doc says 43 reaches end of life in January 2027, which is when 46 is due. At the 8-week cadence, 47 would follow about 8 weeks later. That is an estimate: the release schedule page couldn't be reached from here.

If you'd rather have one PR, go straight to 45.0.x on 28 Oct and do both PRs' changes together.

## Breaking changes that touch the app

I read the 34.0 to 45.0 sections of `docs/breaking-changes.md`, plus the planned 46.0 one. Then I searched `src/main`, `src/renderer`, `src/shared`, `scripts`, `electron-builder.yml`, the Vite configs and the workflows for each removed or changed API. Only the matches are listed.

### Needs a code change

| Since | Change | Where | What to do |
|---|---|---|---|
| 42 | The `electron` package has no install script. It downloads its binary the first time `require('electron')` or `npx electron` runs. | `package.json` `allowScripts.electron`; `scripts/dev.mjs:10`; `.github/workflows/ci.yml:30` (comment) | Remove the `allowScripts` entry. The first `npm start` after an install downloads Electron. Fix the CI comment. |
| 43 | Open and save dialogs start in Downloads when no `defaultPath` is given, and the OS no longer remembers the last folder | `src/main/ipc.ts:237` ("Select a project folder") | Pass a `defaultPath`. The export dialog (`ipc.ts:691`) already does. |
| 44 | Main process `clipboard.writeText` returns a Promise | `src/main/preview.ts:425` ("Copy Link Address") | Add a `.catch`, so a failed copy is not an unhandled rejection. tsc and ESLint don't flag it (checked). |
| 45 | `contentTracing.stopRecording` writes Perfetto protobuf, not JSON | `src/main/perf-trace.ts:4`, `:66`, `:79`; `src/renderer/components/settings/DiagnosticsSettings.svelte:35`; the trace names in `perf-trace.test.ts`, `DiagnosticsSettings.svelte.test.ts`, `demo-mock.ts:458`, `__mocks__/setup.ts:171` | Stop naming traces `.json`. Keep pruning old `.json` traces. Drop "chrome://tracing" from the help text: the doc only names the Perfetto UI. |
| 45 (deprecated), 46 (removed) | `safeStorage.isEncryptionAvailable`, `encryptString`, `decryptString` | `src/main/credentials.ts:78`, `:100`, `:135`; mock at `src/main/__mocks__/electron.ts:79` | Move to `isAsyncEncryptionAvailable`, `encryptStringAsync` and `decryptStringAsync`, which 44.9.0 already has. The callers (`agent-session.ts`, `ipc.ts`, `prerequisites.ts`, `adapters/claude-code.ts`, `adapters/acp/acp-adapter.ts`) become async. The doc says data from `encryptString` decrypts with `decryptStringAsync`. |

### Behaviour changes, no code change needed

- **35, deprecated:** the positional `console-message` arguments, used at `src/main/preview.ts:305`. The 44.9.0 and 45.0.0 typings still have them, marked `@deprecated`. The event object's `level` is now a string (`info`, `warning`, `error`, `debug`), so moving to it would also retire `consoleLevel` (`preview-log.ts:23`).
- **37:** an unhandled rejection in a utility process now logs a warning instead of crashing it (`src/main/process-host-child.ts:38`). A host whose reply fails stays up, and the main process's deadline still restarts it.
- **42:** offscreen pages render at scale factor 1.0 by default (`src/main/preview.ts:282`). On a HiDPI screen, the agent's screenshots (`preview.ts:711`, `:713`) come out at the viewport size (1280×800 by default), not at screen pixels. The reported size now matches CSS pixels.

### Checked, no match

- **Preload (45):** sandboxed preloads lose `Buffer`, `setImmediate`, `clearImmediate` and the `events`, `timers` and `url` shims. The main window is sandboxed, since it doesn't set `sandbox` (`index.ts:94`). But `preload.ts` only uses `contextBridge` and `ipcRenderer.on`, `removeListener` and `removeAllListeners`, which stay.
- **`window.open` (39, 45):** both handlers deny every pop-up (`window-guard.ts:37`, `preview.ts:379`).
- **Permissions (45, `display-capture`):** `preview.ts:197` grants only `clipboard-sanitized-write`.
- **`webRequest` filter (35):** none is passed (`preview.ts:204`).
- **`clearStorageData` (36, 42):** it's called without options (`preview.ts:167`).
- **Custom protocol (37, `ProtocolResponse.session`):** `attachments.ts:295` uses `protocol.handle` with a `Response`.
- **ASAR file descriptors (45):** the only `fs.open` reads worktree files (`ipc.ts:2262`). `claude.exe` and the MCP bridge run from `app.asar.unpacked`.
- **`clipboard` in the renderer (44):** the renderer uses `navigator.clipboard`.
- **`net.request` and `Sec-Fetch-Dest` (44):** neither the app nor electron-updater sets that header.
- **32-bit Windows (44):** the build is x64 only.
- **ANGLE DLLs (44):** nothing refers to them.
- **Menu bar in full screen (34):** the window is frameless.
- **`nativeTheme`:** nothing listed.

### Planned for 46 (the doc says these may change)

- The sync `safeStorage` calls are removed (above).
- `utilityProcess` `child.kill()` no longer force-kills (`process-host.ts:252`, `:504`, `:624`). On Windows it still terminates the process, per the doc.
- `capturePage` images carry the page's scale factor, so `getSize()` returns DIPs (`preview.ts:713`).

## Native modules

**node-pty 1.1.0 needs no rebuild:**

- It is a Node-API addon: it depends on `node-addon-api` ^7.1.0 and registers with `NODE_API_MODULE`.
- It ships Windows x64 prebuilds: `pty.node`, `conpty.node`, `conpty_console_list.node`, `winpty.dll`, `winpty-agent.exe`, plus `conpty/conpty.dll` and `conpty/OpenConsole.exe`.
- Its install script (`node scripts/prebuild.js || node-gyp rebuild`) only checks that the prebuild folder exists, so nothing compiles on Windows x64.
- Node-API is ABI stable across Node versions. So the same files load in Electron 44 (`NODE_MODULE_VERSION` 149) and 45 (150), and `npmRebuild: false` stays.
- `scripts/smoke-pty.mjs` checks this in the packaged app.

**The agent SDK has no native addon.** Its Windows package, `@anthropic-ai/claude-agent-sdk-win32-x64` 0.3.281, holds only `claude.exe` (240 MB), a separate program. The app runs it from `app.asar.unpacked` in its own process, so Electron's Node version doesn't matter. `scripts/smoke-agent.mjs` checks it.

The other run-time packages (the SDK's main package, electron-updater) contain no `.node` files.

## Node and Chromium

| | 33.3.2 (now) | 44.9.3 | 45.0.0 |
|---|---|---|---|
| Chromium | 130.0.6723.191 | 152.0.7977.167 | 156.0.8078.48 |
| Node | 20.18.1 | 24.22.0 | 24.22.0 |

The app's main process moves from Node 20 to 24. CI already runs the tests on Node 24 (`node-version: 24`), so plain Node code is tested there today. What depends on the Node version:

- **`freeze-log.ts:385-403`** wraps the undocumented `ChildProcess.prototype.spawn(options)` and reads `options.file` and `options.args`. Node v24.22.0 has the same shape. It already does nothing if `spawn` is missing.
- **Shell spawns.** Node 24 warns at run time when `spawn` or `execFile` get `args` together with `shell` (DEP0190). The app joins the command line itself (`process-host-spawn.ts:209-216`), and so does execa 9.6.1, so no warning is expected.
- **Removed Node APIs.** Searching `src/main` and `src/shared` for `url.parse`, `new Buffer(`, `util.is*`, `fs.rmdir`, `punycode`, `SlowBuffer`, `createCipher(` and `process.binding` found nothing.
- **Installing.** electron 44 and 45, `@electron/get` 5 and `@electron-internal/extract-zip` need Node 22.12.0 or later (`engines`). With `engine-strict=true`, an older Node stops `npm install`. CI is fine; check the Windows dev machine.
- **Typings.** electron 44 and 45 depend on `@types/node` ^24.9.0 (33 used ^20.9.0); the root has 22.19.11. In a scratch copy, `tsc --noEmit` passed against the 44.9.0 and 45.0.0 `electron.d.ts`, using the root `@types/node`. The real install will nest a 24.x copy. svelte-check was not run.

## electron-builder and electron-updater

The lockfile moved from electron-builder 26.8.1 and electron-updater 6.8.3 to 26.17.0 and 6.8.10 during this check (commit c030666). Both pairs were read, and both give the same answers.

- **electron-builder needs no change.** app-builder-lib reads the version from `node_modules/electron/package.json` and downloads `electron-v<version>-win32-x64.zip` itself (with `@electron/get` ^3.0.0). Its only Electron version checks are for Linux targets. So packaging doesn't need the binary that npm no longer downloads.
- **electron-builder.yml needs no change.** The `npmRebuild: false` comment stays true.
- **electron-updater needs no change.** It calls `app`, `session.fromPartition`, `net.request`, `shell.openPath` and `Notification`, none of which are in the breaking list.
- **Newer releases are not needed.** electron-builder 26.18.0 and electron-updater 6.8.11 (both 20 Oct 2026) can be a separate bump.

## Changes

### Why one jump

Go straight from 33 to 44. 34 to 43 are all out of support, so stopping at any of them ships versions that get no fixes. The changes that hit the app are few and listed above. Each stop would also need its own Package run and hand test. If something breaks and the cause isn't clear, bisect locally with an in-between major, without shipping it.

### PR 1: Electron 44 (on or after 28 Oct 2026, 03:31 UTC)

1. With npm 11.19.0 or later, run `npm install -D electron@~44.9.3`. `package.json` and the lockfiles were changing while this was written, so start from `main` as it is then.
2. In the lockfile, check for: electron 44.9.3 with no `hasInstallScript`, `@electron/get` 5.x, `@electron-internal/extract-zip` 1.0.x, and a nested `@types/node` 24.x. npm picks versions that are 7 days old, so the Dependency age check should pass.
3. In `package.json`, remove `"electron": true` from `allowScripts`.
4. Code:
   - `ipc.ts:237`: pass a `defaultPath`.
   - `preview.ts:425`: catch the `writeText` promise.
   - Optional: `preview.ts:305`, read the event object.
5. Text:
   - "Electron 33" in `CLAUDE.md:7`, `CONTRIBUTING.md:21` and `demo-mock.ts:228`.
   - The comment at `ci.yml:30`.
6. Run `npm run typecheck`, `npm run lint`, `npm run knip`, `npm test` and `npm run build`. Then `npm start` on Windows (the first run downloads Electron).
7. Let CI, Dependency age and Package pass. Package runs on `windows-latest`: `npm ci`, type check, tests, `npm run dist`, then `smoke-deps.mjs`, `smoke-pty.mjs` and `smoke-agent.mjs`.
8. Install the Package artifact and do the hand tests below.
9. Ship it in the normal weekly alpha, then check that the previous alpha updates to it.

### PR 2: Electron 45 (after a few 45.x patches, well before 46)

1. Make the trace file changes listed above.
2. Move `credentials.ts` to the async `safeStorage` calls. This could also go into PR 1, since 44.9.0 has them.
3. Run `npm install -D electron@~45.<newest allowed>`, then the same checks and hand tests.

### Hand tests

- **Terminal:** open several terminals, run commands, resize, close.
- **Threads:**
  - Start a Claude Code thread and an ACP agent thread.
  - Use Grove's memory and Preview tools, which go through the MCP bridge in `ELECTRON_RUN_AS_NODE` mode.
- **Preview tab, your page:**
  - Load a localhost page, then go back, forward and reload.
  - Open DevTools.
  - Right-click and choose "Copy Link Address".
  - Open a menu over the page and check that the still picture shows.
- **Preview tab, the agent's page:**
  - Run `preview_open`, then take a screenshot and note its size.
  - Click, type, and trigger an alert.
  - Check that `preview_logs` shows console messages at the right level.
  - Check that a `file://` outside the worktree is blocked, and so is a download.
- **Attachments:**
  - Paste an image into the prompt and check that it still shows after a restart (`grove-attachment://image`).
  - Check that an image the agent made in the worktree shows (`grove-attachment://worktree`).
- **Credentials:**
  - Check that a key saved under 33 still works after the upgrade.
  - Save a new key, then clear it.
- **Auto-update:**
  - Install the previous alpha and update from the pill.
  - Update through install-on-quit.
- **Other:**
  - Check where the project folder dialog opens.
  - Switch the theme (System, Light, Dark).
  - Check notifications and the taskbar badge.
  - Check the spell-check menu.
  - Record a trace in Settings, Diagnostics, and open it at ui.perfetto.dev.
  - Sleep and resume, check that git status still works, and quit with threads running.

## Open questions

- **44 then 45, or 45 directly?** Ship 44 now and 45 later, or go to 45 on 28 Oct in one PR?
- **Project folder dialog.** Where should it start: the parent folder of the last project added?
- **Trace files.** What should they be named once they are protobuf?
- **Rolling back.** Can a 33-based build open a data folder that a 44-based build has used? Not checked. If it can't, a problem after release needs a fix forward, not a rollback.
- **Stale `allowScripts` entry.** Does npm warn about an entry for a package with no install script? Not checked. The plan removes it anyway.
- **Not verified from here.** The proxy blocked releases.electronjs.org and github.com (release notes, schedule), so no Electron release notes were read and no end-of-life dates were confirmed. Nothing was run in Electron: the behaviour changes above come from the docs and the typings.

## Sources

- **npm registry, read 25 Oct 2026:**
  - `npm view electron time --json` and `npm view electron dist-tags`: every publish date and the 22 releases of 44.
  - `npm view electron-builder time`, `npm view electron-updater time`, and `npm view <pkg> scripts engines time` for `@electron/get` and `@electron-internal/extract-zip`.
- **Advisories:** `POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`, with `{"electron":["33.3.2"]}`, then `["44.9.0","44.9.3","45.0.0","43.8.3"]`. For the eMudhra one, see https://github.com/advisories/GHSA-jr5w-w6x2-84p9.
- **Support policy:** https://github.com/electron/electron/blob/main/docs/tutorial/electron-timelines.md ("Version support policy").
- **Breaking changes:**
  - https://github.com/electron/electron/blob/main/docs/breaking-changes.md
  - The same file at tags `v45.0.0` and `v44.9.0`: same 45 section, and the 44 section lists the same backports.
  - The 43 end-of-life note is in the 44.0 section ("Removed: Windows 32-bit").
- **Chromium and Node versions:** `DEPS` at https://github.com/electron/electron/blob/v33.3.2/DEPS, and at the tags `v44.9.0`, `v44.9.3` and `v45.0.0`.
- **`npm pack electron@44.9.0` and `electron@45.0.0`:**
  - `package/package.json`: no `scripts`, `engines.node >= 22.12.0`, dependencies.
  - `package/index.js` (downloads on first `require`) and `package/install.js`.
  - `package/abi_version` (149 and 150).
  - `package/electron.d.ts`:
    - `clipboard.writeText`: 44.9.0 line 7390, 45.0.0 line 7486.
    - `safeStorage`: 44.9.0 lines 12473-12532, 45.0.0 lines 12705-12786.
    - `console-message`: 44.9.0 line 16742.
    - `contentTracing.stopRecording`: 45.0.0 lines 7653-7675.
- **`npm pack electron@33.3.2`:** `package/package.json` (`postinstall: node install.js`).
- **`npm pack node-pty@1.1.0`:**
  - `package/package.json` (`scripts.install`, `dependencies`), `package/binding.gyp:4`, `package/scripts/prebuild.js`, `package/lib/utils.js` (`loadNativeModule`).
  - `package/src/win/conpty.cc:583`, `winpty.cc:333`, `conpty_console_list.cc:44`.
  - `package/prebuilds/win32-x64/`.
- **Node-API stability:** https://github.com/nodejs/node/blob/v24.22.0/doc/api/n-api.md (introduction). Electron's note on native modules: https://github.com/electron/electron/blob/v44.9.0/docs/tutorial/using-native-node-modules.md
- **`npm pack @anthropic-ai/claude-agent-sdk@0.3.281`:** `package/package.json` (`optionalDependencies` per platform).
- **`npm pack @anthropic-ai/claude-agent-sdk-win32-x64@0.3.281`:** `package/package.json`, and the file list: `claude.exe`, `package.json`, `README.md`, `LICENSE.md`.
- **`npm pack app-builder-lib@26.8.1`:** `out/electron/electronVersion.js:25-36`, `out/electron/ElectronFramework.js:185-202`, `out/targets/snap.js:237`, `package.json` (`@electron/get` ^3.0.0).
- **`npm pack app-builder-lib@26.17.0`:** `out/electron/electronVersion.js:25-28`, `out/electron/ElectronFramework.js:204-230`, `out/targets/LinuxTargetHelper.js:90-123`, `package.json` (`@electron/get` ^3.0.0).
- **`npm pack electron-updater@6.8.3` and `@6.8.10`:** `out/electronHttpExecutor.js:8`, `:54`, `out/NsisUpdater.js:140`, `out/AppUpdater.js:296` (same lines in both).
- **Node DEP0190:** https://github.com/nodejs/node/blob/v24.x/doc/api/deprecations.md#dep0190-passing-args-to-nodechild_process-execfilespawn-with-shell-option
- **Node `ChildProcess.prototype.spawn`:** https://github.com/nodejs/node/blob/v24.22.0/lib/internal/child_process.js (lines 385, 416, 422) and the `v20.x` branch (lines 354, 385, 391).
- **execa 9.6.1:** `node_modules/execa/lib/arguments/shell.js:9-11`.
- **Type and lint check:**
  - A scratch copy of `src/` and `tsconfig.json`, with `node_modules` linked to this checkout's and `node_modules/electron` swapped for each tarball.
  - `tsc --noEmit` gave 0 errors with 33.3.2, 44.9.0 and 45.0.0.
  - ESLint (this repo's config) on `preview.ts`, `credentials.ts`, `perf-trace.ts` and `ipc.ts` with 44.9.0 found no new errors.
- **This repo:** the files and lines named above, `.github/workflows/package.yml`, `ci.yml`, `dependency-age.yml`, `.npmrc`, `electron-builder.yml`, and `package-lock.json` at c030666 (electron 33.3.2, node-pty 1.1.0, electron-builder 26.17.0, electron-updater 6.8.10).
