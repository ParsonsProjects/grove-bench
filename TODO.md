# Grove Bench — Gap Analysis

Feature gaps identified by comparing against [Toad](https://github.com/batrachianai/toad) and [T3 Code](https://github.com/pingdotgg/t3code), plus gaps found by auditing the codebase against DESIGN.md and docs/user-stories.md.

## Priority 1 — High Impact

### Multi-Agent Support
- [ ] Support multiple agent backends (Gemini, Codex, OpenHand) beyond Claude
- [ ] Agent discovery/install marketplace ("app store")
- [ ] Agent Client Protocol for custom agent integration

### Embedded Terminal
- [x] Full working shell with color support and interactive command execution
- [x] Persistent shell state (env vars, directory changes across commands)
- [x] Per-session PTY terminals (split, toggle, resize, clear, restart)
- [ ] Attach terminal output as context to AI messages

### Checkpointing & Revert
- [x] Git-based snapshots at each agent turn
- [x] Per-turn diff viewing (what changed in each turn)
- [x] Revert workspace to any previous turn's checkpoint
- [ ] Preserve checkpoints across `/clear` — currently checkpoints are reset on clear; a better solution would keep git checkpoint refs and rebuild the checkpoint list independently of message history

### Settings UI
- [x] GUI-based settings panel (no manual JSON editing)
- [x] Configurable UI layouts (full-featured to minimal)

### Merge-Back Workflow
- [x] Wire up existing `mergeNoCommit()` / `abortMerge()` (`git.ts`) to IPC and UI
- [x] Merge a session's worktree branch back into the base branch from within the app, with conflict detection and abort (Changes tab clean state + session context menu; conflicts auto-abort)
- [ ] Rebase / cherry-pick / squash between agent branches (DESIGN.md §14 "Git operations UI")

### OS Notifications
- [ ] Native notification when an agent finishes a turn while the window is unfocused
- [ ] Native notification when an agent is blocked on a permission prompt
- [ ] Taskbar flash / overlay badge for sessions needing attention

### Robustness
- [ ] Global error handling — `uncaughtException` handler in main; `window.onerror` / `unhandledrejection` + error boundary in renderer
- [ ] Opt-in crash reporting (exception capture alongside existing PostHog analytics)
- [ ] Schema versioning + migration for persisted state (`settings.ts` `validate()` is an empty stub; `app-state.ts` raw-parses JSON with no upgrade path)

## Priority 2 — Notable Gaps

### Diff Viewer
- [x] Side-by-side diff view option (toggle in Edit tool header)
- [ ] Syntax highlighting in diff views across multiple languages
- [ ] Full thread diff view (cumulative changes across all turns)

### PR Creation Workflow
- [ ] Dedicated PR creation dialog (title, body, base branch)
- [ ] Auto-populate PR description from agent's changes
- [ ] Call `gh pr create` from within the app

### Session Search
- [x] Fuzzy search to find and resume past conversations (Ctrl+R)
- [x] Filter/search within message history (Ctrl+F with highlighting)

### Help System
- [ ] Keybinding documentation (F1 or similar) — content exists at `docs/help/keyboard-shortcuts.md`; missing piece is the in-app F1 surface
- [ ] Context-aware footer showing relevant keyboard shortcuts

### Cost & Usage Dashboard
- [ ] Per-session and cumulative token/cost view — data is already captured per message (`adapters/claude-code.ts`) but only lands in memory notes

### Session Export
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
- [ ] Component tests (3 of 41 Svelte components covered) and E2E tests (Playwright)
- [ ] In-app log viewer or "open logs folder" action; configurable log level
- [ ] Worktree disk-usage reporting and a "reclaim space" tool
- [ ] Purge userData on uninstall (NSIS currently leaves settings/logs/worktrees behind)
- [ ] CHANGELOG.md and SECURITY.md
- [ ] Fetch Claude model list dynamically instead of hardcoding (`adapters/claude-code.ts` TODO)

### From DESIGN.md v2 (documented but previously untracked)
- [ ] Docker-based sandboxing of agent sessions
- [ ] Shared CLAUDE.md / agent instructions per worktree
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

### Agent Capabilities
- [x] `/rewind` — Roll back to a previous message checkpoint, restoring files on disk (SDK: `query.rewindFiles()`). See `docs/rewind-plan.md`
- [ ] `/btw` — Ephemeral side question that doesn't enter conversation history. Runs while agent is working, no tool access, shows in dismissible overlay. No SDK support — needs separate `query()` call with `maxTurns: 1`
- [x] Commands (slash commands for common actions)
- [x] Skills (reusable prompt templates / workflows)
- [x] MCP server connections (connect to external MCP servers)

### Git & Workflow
- [ ] Branch → PR link (create PR from session branch)
- [x] Branch without worktree (use existing checkout, no worktree creation)
- [ ] Stacked branch workflows (dependent branch chains)

### Configuration
- [ ] Customizable keybindings (`~/.grove-bench/keybindings.json`)
- [ ] Project scripts (user-defined scripts bound to keyboard shortcuts)

### Dev & Preview
- [x] Localhost run (start/preview dev server from worktree)

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
- **Dev Server Management** — auto-detect dev commands, start/stop, detect localhost ports, kill port conflicts
- **Tool Visibility Control** — allow/deny rules with glob patterns (more granular than t3's sandbox modes)
- **Power Monitoring** — flush state on suspend, health-check on resume
- **Changes Review Panel** — dedicated panel with file staging/unstaging, revert individual files
