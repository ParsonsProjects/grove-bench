# Grove Bench — Implementation Plan

## Context

Grove Bench is a greenfield Windows Electron app that orchestrates multiple Claude Code agents in isolated git worktrees. The repo currently contains only `DESIGN.md` (v0.3) — no code, no configs, no `package.json`. This plan implements the full v1 design in 7 phases, each producing something runnable.

## Key Technical Findings

1. **Electron Forge + Vite + Svelte 5**: Config files must use `.mjs` extension. `"type": "module"` required in `package.json`. Forge's Vite plugin builds main process as CJS, which handles ESM-only deps (execa) automatically.
2. **node-pty**: Must be externalized in Vite config (`rollupOptions.external`), rebuilt via `@electron/rebuild`, and unpacked from ASAR via `@electron-forge/plugin-auto-unpack-natives`.
3. **execa v9 (ESM-only)**: Must NOT be externalized — Vite bundles it into CJS. This just works.
4. **xterm.js packages**: Use `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` (new `@xterm` scope).
5. **Tailwind v4**: Use `@tailwindcss/vite` plugin — no PostCSS or `tailwind.config.js` needed. Just `@import "tailwindcss"` in CSS.
6. **Svelte 5 runes**: State files must use `.svelte.ts` extension (not `.ts`) for `$state`/`$derived` to work.
7. **svelte-splitpanes**: May have Svelte 5 compat issues — fallback is a custom ~80-line CSS Grid splitter.

---

## Phase 0: Project Scaffold & Build Pipeline

**Goal**: `npm start` opens an Electron window with Svelte 5 + Tailwind rendering.

**Files to create**:
- `package.json` — deps: electron ~33.3, svelte ^5, vite ^6, tailwindcss ^4, @tailwindcss/vite, @sveltejs/vite-plugin-svelte ^5, @electron-forge/cli + plugin-vite + plugin-auto-unpack-natives + maker-squirrel + maker-zip, @electron/rebuild, typescript ~5.7
- `forge.config.mjs` — VitePlugin (main entry, preload entry, renderer entry), AutoUnpackNativesPlugin
- `vite.main.config.mjs` — external: ['electron']
- `vite.preload.config.mjs` — external: ['electron']
- `vite.renderer.config.mjs` — plugins: [svelte(), tailwindcss()]
- `svelte.config.js` — vitePreprocess
- `tsconfig.json` — target ES2022, moduleResolution bundler, verbatimModuleSyntax
- `src/main/index.ts` — minimal BrowserWindow, loads renderer
- `src/main/env.d.ts` — declares `MAIN_WINDOW_VITE_DEV_SERVER_URL`
- `src/main/preload.ts` — contextBridge stub (`ping: () => 'pong'`)
- `src/renderer/index.html` — shell with `<div id="app">`
- `src/renderer/main.ts` — mounts Svelte App
- `src/renderer/App.svelte` — "Grove Bench is running" with `$state` rune (proves Svelte 5 works)
- `src/renderer/styles/globals.css` — `@import "tailwindcss"`
- `src/shared/types.ts` — empty placeholder
- `.gitignore` — node_modules, out, .vite, dist, .grove-wt

**Verify**: `npm install` succeeds, `npm start` shows styled window, HMR works on Svelte edits.

---

## Phase 1: Shared Types + IPC Skeleton

**Goal**: Full type definitions + complete preload bridge with stub handlers. Two-way IPC roundtrip works.

**Files to create/modify**:
- `src/shared/types.ts` — all interfaces: WorktreeConfig, WorktreeInfo, CreateSessionOpts, SessionInfo, PrerequisiteStatus, GroveBenchAPI, WorktreeRepoConfig
- `src/main/preload.ts` — full `contextBridge.exposeInMainWorld('groveBench', {...})` implementing GroveBenchAPI via `ipcRenderer.invoke`/`ipcRenderer.send`/`ipcRenderer.on`
- `src/main/ipc.ts` — `ipcMain.handle` stubs for all channels (repo:select, repo:validate, session:create, session:destroy, session:list, prerequisites:check) + `ipcMain.on` for term:write, term:resize
- `src/renderer/global.d.ts` — augments `Window` with `groveBench: GroveBenchAPI`
- `src/main/index.ts` — imports and calls `registerHandlers()` from ipc.ts

**Verify**: `window.groveBench.checkPrerequisites()` from DevTools returns structured stub data.

---

## Phase 2: node-pty Integration (Highest Risk)

**Goal**: Spawn a real PTY, send/receive data through IPC. Raw text UI (pre + textarea) to prove PTY works.

**Files to create/modify**:
- `package.json` — add `node-pty ^1.0.0`, postinstall: `electron-rebuild`
- `vite.main.config.mjs` — add `'node-pty'` to rollupOptions.external
- `src/main/shell-detect.ts` — detect pwsh > powershell > cmd via `where.exe`
- `src/main/agent-session.ts` — minimal: spawn PTY, write/resize/onData, destroy with kill + 5s timeout
- `src/main/ipc.ts` — wire real session:create, term:write, term:resize + send term:data:{id} to renderer
- `src/renderer/App.svelte` — temp test UI: "Spawn Shell" button, `<pre>` output, `<textarea>` input

**Gotchas**: Needs Python 3 + VS Build Tools on Windows for native rebuild. If import fails, use `createRequire(import.meta.url)` for dynamic require of node-pty.

**Verify**: Can type `echo hello` in textarea, see response. `dir` shows listing. Destroy kills shell.

---

## Phase 3: xterm.js Terminal Pane

**Goal**: Replace raw text UI with interactive xterm.js terminal via Svelte action.

**Files to create/modify**:
- `package.json` — add `@xterm/xterm ^5.5.0`, `@xterm/addon-fit ^0.10.0`, `@xterm/addon-web-links ^0.11.0`
- `src/renderer/actions/terminal.ts` — Svelte action: creates Terminal, loads FitAddon + WebLinksAddon, wires IPC, ResizeObserver, returns destroy cleanup
- `src/renderer/components/TerminalPane.svelte` — `<div use:terminal={session.id}>` wrapper
- `src/renderer/styles/globals.css` — add `@import "@xterm/xterm/css/xterm.css"`
- `src/renderer/App.svelte` — use TerminalPane component instead of textarea
- `src/main/agent-session.ts` — add 16ms output batching (debounce PTY data before IPC send)

**Verify**: Full interactive terminal, colors work, resize works, scrollback works, Claude Code renders correctly if launched manually.

---

## Phase 4: Git Operations + WorktreeManager

**Goal**: Full worktree lifecycle via execa + git CLI. Tested from DevTools.

**Files to create/modify**:
- `package.json` — add `execa ^9.5.0` (do NOT externalize in Vite config)
- `src/main/git.ts` — typed wrapper: `git(args, cwd)`, `gitVersion()`, `isGitRepo(path)`
- `src/main/worktree-manager.ts` — full implementation:
  - `create()`: `git worktree add -b`, 8-char ID via `crypto.randomUUID().slice(0,8)`, path `<repo>/.grove-wt/<id>/`, auto-add .grove-wt to .gitignore, generate `.claude/settings.local.json` with deny rules
  - `remove()`: retry chain (normal → --force → fs.rm + prune → log warning), optional branch delete
  - `list()`: parse `git worktree list --porcelain` for .grove-wt entries
  - `cleanupAll()`: remove all + prune
  - `validateRepo()`, `copyUntrackedFiles()`
- `src/main/ipc.ts` — implement repo:select (Electron dialog.showOpenDialog), repo:validate

**Verify**: Create worktree → `.grove-wt/<id>/` appears → correct branch → `.claude/settings.local.json` exists → remove cleans up.

---

## Phase 5: Prerequisites + Full Session Lifecycle

**Goal**: End-to-end: select repo → create session (worktree + PTY + terminal) → use → destroy (cleanup worktree). Single session.

**Files to create/modify**:
- `src/main/prerequisites.ts` — `checkGit()` (version ≥2.17), `findClaudeCode()` (where.exe claude), `checkAllPrerequisites()`
- `src/main/agent-session.ts` — full flow: check prereqs → check count < 3 → create worktree → copy files → spawn PTY in worktree with `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` → wire IPC → track status. Destroy: kill PTY → wait 500ms → remove worktree
- `src/main/index.ts` — `before-quit` handler calls `sessionManager.destroyAll()` with `event.preventDefault()` + re-quit after cleanup
- `src/main/ipc.ts` — all handlers implemented with real logic
- `src/renderer/App.svelte` — minimal flow UI: prereq check → repo select → create session → terminal → destroy

**Verify**: Full lifecycle works. `pwd` in terminal shows worktree path. Destroying session cleans worktree. App quit cleans everything.

---

## Phase 6: Multi-Session UI

**Goal**: Full design mockup: sidebar + up to 3 split terminal panes + dialogs.

**Files to create/modify**:
- `package.json` — add `svelte-splitpanes ^9.0.0` (fallback: custom CSS Grid splitter if Svelte 5 incompat)
- `src/renderer/stores/sessions.svelte.ts` — Svelte 5 rune-based state (sessions array, selectedRepo, activeSessionId)
- `src/renderer/components/Sidebar.svelte` — repo display, agent list with status dots, + New Agent button
- `src/renderer/components/RepoSelector.svelte` — folder picker trigger
- `src/renderer/components/NewAgentDialog.svelte` — modal: branch name input (auto-suggest), base branch, node_modules note
- `src/renderer/components/ErrorToast.svelte` — toast stack, auto-dismiss 5s
- `src/renderer/components/PrerequisiteCheck.svelte` — blocking overlay if prereqs fail
- `src/renderer/App.svelte` — full layout: fixed sidebar | split pane area with dynamic terminal panes

**Verify**: Create 3 agents with different branches, each in own pane. Resize panes. Status indicators update. 4th agent blocked. Sidebar focus works.

---

## Phase 7: Polish & Edge Cases

**Goal**: Production-ready robustness.

**Key work**:
- Orphan worktree detection on startup (scan .grove-wt dirs vs `git worktree list`)
- `.grove-wt/config.json` for per-repo auto-copy file lists (scan for .env*, .npmrc, .nvmrc on first use)
- Window state persistence (position/size → `%APPDATA%/grove-bench/`)
- File logging to `%APPDATA%/grove-bench/logs/` (5 files, 10MB rotation)
- Loading states during session create/destroy
- Confirmation dialog before destroying session with commits
- Branch name validation via `git check-ref-format`

**Verify**: Crash recovery works (orphans cleaned). .env copied. Logs written. Graceful shutdown.

---

## Phase Dependency Graph

```
Phase 0 (scaffold)
  └→ Phase 1 (types + IPC)
       ├→ Phase 2 (node-pty)  ──→  Phase 3 (xterm.js)  ─┐
       └→ Phase 4 (git/worktree)  ─────────────────────────┤
                                                            ↓
                                                   Phase 5 (full lifecycle)
                                                            ↓
                                                   Phase 6 (multi-session UI)
                                                            ↓
                                                   Phase 7 (polish)
```

Phases 2+3 and Phase 4 can run in parallel after Phase 1.

## Critical Risk Items

| Risk | Mitigation | Fallback |
|------|-----------|----------|
| node-pty rebuild fails for Electron 33 | Test in Phase 2 first | @homebridge/node-pty-prebuilt-multiarch |
| Forge + Vite + Svelte 5 ESM issues | Use .mjs configs, test in Phase 0 | electron-vite instead of Forge |
| svelte-splitpanes Svelte 5 incompat | Test in Phase 6 | Custom CSS Grid splitter (~80 lines) |
| execa ESM bundling issues | Don't externalize, let Vite bundle | child_process.execFile wrapper |
