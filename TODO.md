# Grove Bench — Gap Analysis

Feature gaps identified by comparing against [Toad](https://github.com/batrachianai/toad) and [T3 Code](https://github.com/pingdotgg/t3code), plus gaps found by auditing the codebase against DESIGN.md and docs/user-stories.md.

## Priority 1 — High Impact

### Multi-Agent Support
- [x] Adapter-declared session controls — `AgentAdapter.getControls(model)` returns per-model `ControlDescriptor`s (mode, thinking, speed, …); the session manager owns the values, validates them per model, passes them to `adapter.start()`, and emits `controls_sync`. The renderer no longer hardcodes thinking or permission-mode enums.
- [x] Agent settings popover — one two-line status-bar trigger (agent on top; model, mode, and any non-default control beneath) opening a column-per-setting popover for agent, model, and every declared control (`SessionControlsPopover.svelte`). Alt+M / Alt+T still cycle.
- [ ] Codex adapter — implement `getControls`, `getModels`, `start`, `setControl`, and `getUsage` against the Codex app-server protocol and register it; the popover, shortcuts, triage, and session manager need no changes
- [ ] Grok Build adapter
- [x] Per-adapter defaults in Settings — `adapterDefaults` (adapter id → control id → value) replaces `defaultThinkingLevel` (settings schema v2 migration); the Agent tab lists every registered adapter's declared controls for the default model via `getAdapterControls`, and `initialControls` overlays the saved values that the adapter actually offers
- [x] Neutral form for tool allow/deny rules — rules are `<tool>` / `<tool>(<glob>)` with adapter-neutral keywords (`shell`, `edit`, `read`, `web`, `agent`, `question`, `mcp`) matched by tool category; adapters build the call specifier with `toolCallSpecifier` (command, file path, URL, ...). Provider tool names (`Bash(...)`) keep working, so no migration
- [ ] Switch agent mid-conversation — needs the on-disk transcript (see Session Export) to replay context into another backend
- [ ] Agent discovery/install marketplace ("app store")
- [ ] Agent Client Protocol for custom agent integration

### Embedded Terminal
- [x] Full working shell with color support and interactive command execution
- [x] Persistent shell state (env vars, directory changes across commands)
- [x] Per-session PTY terminals (split, toggle, resize, clear, restart)
- [x] Attach terminal output as context to AI messages — "To prompt" in the terminal toolbar inserts the selection (or the last 200 lines of scrollback) into the prompt as a fenced block and switches to Activity

### Checkpointing & Revert
- [x] Git-based snapshots at each agent turn
- [x] Per-turn diff viewing (what changed in each turn)
- [x] Revert workspace to any previous turn's checkpoint
- [x] Preserve checkpoints across `/clear` — the git refs are kept and a `__clear__` sentinel checkpoint marks the boundary; `list()` flags earlier turns `beforeClear`, the Checkpoints tab shows them under a "Before /clear" divider with a files-only Restore (the conversation they belonged to is gone, so no conversation rewind is offered)

### Settings UI
- [x] GUI-based settings panel (no manual JSON editing)
- [x] Configurable UI layouts (full-featured to minimal)

### Merge-Back Workflow
- ~~Merge a session's branch into the base branch from within the app~~ — implemented, then removed; sessions land their work through the PR workflow instead (local `git merge` from the terminal remains available for repos without a remote)
- [x] Rebase / cherry-pick / squash between agent branches — "Branch…" in the Changes tab opens `GitOpsDialog` (rebase onto the base or another session's branch, squash every commit since the base into one, cherry-pick a commit from another session's branch); operations refuse on a dirty tree and any conflict is aborted and reported with the file list, so the branch is never left mid-operation

### OS Notifications
- [x] Native notification when an agent finishes a turn while the window is unfocused
- [x] Native notification when an agent is blocked on a permission prompt or question, and for PR-watch alerts (new CI failure / review comments / needs-human)
- [x] Taskbar flash while a notification is pending (cleared on focus); clicking a notification jumps to the session
- [x] Sidebar attention flash extended to PR alerts (previously only status-bar chips)
- [x] Overlay badge on the taskbar icon showing the count of sessions needing attention — renderer draws the count bitmap (`attention-badge.ts`), main applies it via `setOverlayIcon` (Windows) / dock badge (macOS) / `setBadgeCount` (Linux); toggle in Settings → Notifications

### Attention Triage
- [x] Sidebar filter chips All / Needs you / Working / Unread with counts — `session-triage.ts` puts each session in exactly one state (needs-you = pending permission or question, working = turn in progress, unread = finished while unfocused)
- [x] Per-repo attention counts on each Projects header
- [x] Mark Completed / Reopen in the session context menu — persisted as `completedAt` in the worktree manifest, hidden behind a "Show completed" toggle, reopened automatically by the next user message
- [x] Sidebar sections renamed: Conversations (live working set) and Projects (each repo with all its sessions)
- [x] Persist the unread flag across restarts — `unreadSessionIds` in app-state.json, restored after worktree restore

### Robustness
- [x] Global error handling — `crash-handling.ts` installs `uncaughtException` / `unhandledRejection` handlers in main (file log + forwarded to the renderer as a toast); `error-handling.ts` hooks `window.onerror` / `unhandledrejection` in the renderer (toast + file log via IPC); `<svelte:boundary>` around the sidebar and each session pane with a Reload view button
- [x] Opt-in crash reporting — "Send crash reports" toggle under Privacy (requires analytics on); uncaught errors from either process go to PostHog `captureException` with message, stack, source and kind only
- [x] Schema versioning + migration for persisted state — `persisted-state.ts` (top-level `schemaVersion`, ordered migration table, newer-file handling); settings.json and app-state.json are migrated on load, then validated field by field with Zod so one corrupt value resets to its default instead of dropping the file. Worktree manifest still unversioned.

## Priority 2 — Notable Gaps

### Diff Viewer
- [x] Side-by-side diff view option (toggle in Edit tool header)
- [ ] Syntax highlighting in diff views across multiple languages
- [x] Full thread diff view (cumulative changes across all turns) — "All turns" entry in the Checkpoints tab, plus per-turn diff stats and a This turn / Since here toggle

### PR Creation Workflow
- [x] Dedicated PR creation dialog (title, body, base branch, draft)
- [x] Auto-populate PR title/description from the branch's commits
- [x] Call `gh pr create` from within the app (auto-pushes the branch first)
- [x] One-click Create PR sends a turn to the session's agent (commit → push → PR); manual dialog is the fallback for stopped sessions
- [x] PR status watching — state, checks rollup, review decision polled in the status bar (all sessions, not just the open tab)
- [x] One-click fix turns — clickable failing-checks / changes-requested badges send the agent to read CI logs or review comments and fix
- [x] New-failure / new-comment detection with pulsing alert chips (baseline seeded on startup, one alert per pushed commit)
- [x] Opt-in auto mode per session — auto-fix CI and auto-address reviews (idle-only, max 2 attempts per commit then "needs human", collaborator-authored comments only)
- [x] Commit & Push and one-click push (↑n) from the Changes panel / status bar

### Session Search
- [x] Fuzzy search to find and resume past conversations (Ctrl+R)
- [x] Filter/search within message history (Ctrl+F with highlighting)

### Help System
- [ ] Keybinding documentation (F1 or similar) — content exists at `docs/help/keyboard-shortcuts.md` and HelpPanel is mounted; missing piece is the F1 shortcut
- [ ] Context-aware footer showing relevant keyboard shortcuts

### Cost & Usage Dashboard
- [x] Plan usage runway — `AgentQueryHandle.getUsage()` returns a neutral `ProviderUsage` (windows with 0–1 utilization and reset time); the Claude adapter maps the SDK's experimental `/usage` control and probes for it so a rename degrades to "no usage"; `usage.svelte.ts` keeps one snapshot per provider, refreshes on popover open and after turns (throttled), and folds live `rate_limit` events in; shown as bars under the agent in the Agent settings popover
- [ ] Per-session and cumulative token/cost view — data is already captured per message (`adapters/claude-code.ts`) but only lands in memory notes

### Session Export
- [ ] Markdown transcript per session written to disk (`.grove-wt/<id>/thread.md` or under the repo's memory dir) with an "Open in editor" action — also the enabler for switching agents mid-conversation
- [ ] Export conversation transcript (Markdown / JSON)
- [ ] Session export/import between machines

### Security Hardening
- [ ] Validate IPC inputs at the boundary with Zod (already a dependency, unused for IPC)
- [ ] Enable Electron `sandbox: true` in webPreferences
- [ ] Add a Content-Security-Policy for the renderer

### Onboarding
- [ ] First-launch welcome/tour surfacing the existing `docs/help/` content (currently only prerequisite checks + analytics consent)

## Priority 3 — Nice to Have

### Deployment Options
- [ ] Web mode — serve as browser-accessible app (`npx grove` / `grove-bench serve`)
- [ ] Standalone CLI mode without full Electron app
- [ ] Zero-install entry point via npx (like t3code's `npx t3`)

### Platform
- [ ] Native Linux/macOS support and testing (currently Windows-focused)

### Clipboard
- [x] Copy buttons on code blocks, bash output, diffs, file ops, thinking blocks

### Accessibility & i18n
- [ ] ARIA roles/labels on app components (currently only the vendored bits-ui primitives have them)
- [ ] `prefers-reduced-motion` support
- [ ] i18n framework (all UI strings hardcoded English; spellchecker pinned to `en-US`)

### Maintenance & Hygiene
- [ ] ESLint/Prettier config (CONTRIBUTING.md notes none exists)
- [ ] Tests for the IPC layer (`ipc.ts` currently has zero coverage)
- [ ] Component tests (5 of 42 Svelte components covered) and E2E tests (Playwright)
- [ ] In-app log viewer or "open logs folder" action; configurable log level
- [ ] Worktree disk-usage reporting and a "reclaim space" tool
- [ ] Purge userData on uninstall (NSIS currently leaves settings/logs/worktrees behind)
- [ ] CHANGELOG.md and SECURITY.md
- [ ] Fetch Claude model list dynamically instead of hardcoding (`adapters/claude-code.ts` TODO) — the SDK's `supportedModels()` also reports per-model effort, adaptive-thinking, and fast-mode support, which could replace the static rules in `claudeControlsFor()`
- [ ] Demo harness (`/demo.html`) console errors — duplicate keyed-each id in the Sidebar demo data, and mock bridge methods the demo never defined (`checkPrerequisites`, update listeners)

### From DESIGN.md v2 (documented but previously untracked)
- [ ] Docker-based sandboxing of agent sessions
- [ ] Shared CLAUDE.md / agent instructions per worktree
- [ ] Per-repo agent instructions field in Settings (writes to `CLAUDE.md` or a memory `conventions/` note); today only the global system-prompt append exists
- [ ] Agent-to-agent communication (one agent's output feeds another)
- [ ] Orchestration engine (goal decomposition → parallel tasks → integration merge agent) — prototyped and removed; see user stories 20–28 in `docs/user-stories.md`
- [ ] Worktree dependency optimizations: pnpm-store sharing, `node_modules` symlinking from main checkout (DESIGN.md §6.1)

## Feature Requests

### Input & UX
- [x] Auto-grow input with max height and manual resize
- [ ] Markdown rendering in input (preview mode)
- [x] Context length indicator (token usage / remaining)
- [x] Drag and drop (files, images into prompt)
- [x] Image attachments in messages (paste/drop, up to 8 per turn, pass as base64)

### Markdown Preview Panel
- [x] Slide-out panel rendering markdown full-width (reuses the marked + highlight.js + DOMPurify pipeline; Esc / backdrop click to close, copy button)
- [x] Hover "Focus" button on in-turn assistant responses with document-like markdown (≥2 headings, a table, ≥3 code fences, or structure + length) — works in both Detailed and Summary view modes
- [x] "Focus" on plan-approval blocks so a proposed plan can be read full-width before approving
- [ ] Secondary: preview `.md` files the agent writes (file-op blocks, Changes tab, @ file picker)

### Agent Capabilities
- [x] `/rewind` — Roll back to a previous message checkpoint, restoring files on disk (SDK: `query.rewindFiles()`). See `docs/rewind-plan.md`
- [ ] `/btw` — Ephemeral side question that doesn't enter conversation history. Runs while agent is working, no tool access, shows in dismissible overlay. No SDK support — needs separate `query()` call with `maxTurns: 1`
- [x] Commands (slash commands for common actions)
- [x] Skills (reusable prompt templates / workflows)
- [ ] Recipes on top of skills — collections, a one-click "Run in new session", and a main-process scheduler for on-demand or scheduled runs
- [x] MCP server connections (connect to external MCP servers)

### Git & Workflow
- [x] Branch → PR link (create PR from session branch)
- [x] Branch without worktree (use existing checkout, no worktree creation)
- [ ] Stacked branch workflows (dependent branch chains)

### Configuration
- [ ] Customizable keybindings (`~/.grove-bench/keybindings.json`)
- [ ] Project scripts (user-defined scripts bound to keyboard shortcuts)

### Dev & Preview
- ~~Localhost run (start/preview dev server from worktree)~~ — implemented, then removed; run dev servers from the session terminal instead
- [ ] Named background commands — a list of long-running processes with Running/Stopped state, Stop, follow-the-log, wrap, and downloadable output, decoupled from the session PTY (a narrower reimplementation of the removed dev-server feature)

## Already at Parity or Better

- Multi-session worktree management
- File picker with @ syntax and fuzzy search
- Markdown rendering with syntax highlighting
- Permission handling (Allow / Always Allow / Deny)
- Permission mode cycling (default / plan / acceptEdits)
- Tool output visualization (Bash, Edit, Write, Read, Grep, Glob)
- Thinking block display
- Session status indicators
- Event history replay after reload
- Orphan worktree cleanup

## Advantages Over T3 Code

- **Project Memory System** — persistent markdown notes (repo, conventions, architecture, sessions); t3code has none
- **Orphan Worktree Detection & Cleanup** — auto-detect on startup + 15-min background sweeps
- **Auto-Copy `.env` Files** — automatically copies `.env`, `.npmrc`, etc. to new worktrees
- **Auto-Install Dependencies** — optional npm install with shared cache in new worktrees
- **Tool Visibility Control** — allow/deny rules with glob patterns (more granular than t3's sandbox modes)
- **Power Monitoring** — flush state on suspend, health-check on resume
- **Changes Review Panel** — dedicated panel with file staging/unstaging, revert individual files
