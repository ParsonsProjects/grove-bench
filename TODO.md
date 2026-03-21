# Grove Bench — Gap Analysis

Feature gaps identified by comparing against [Toad](https://github.com/batrachianai/toad) and [T3 Code](https://github.com/pingdotgg/t3code).

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
- [ ] Git-based snapshots at each agent turn
- [ ] Per-turn diff viewing (what changed in each turn)
- [ ] Revert workspace to any previous turn's checkpoint

### Settings UI
- [ ] GUI-based settings panel (no manual JSON editing)
- [ ] Configurable UI layouts (full-featured to minimal)

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
- [ ] Keybinding documentation (F1 or similar)
- [ ] Context-aware footer showing relevant keyboard shortcuts

## Priority 3 — Nice to Have

### Deployment Options
- [ ] Web mode — serve as browser-accessible app (`npx grove` / `grove-bench serve`)
- [ ] Standalone CLI mode without full Electron app
- [ ] Zero-install entry point via npx (like t3code's `npx t3`)

### Platform
- [ ] Native Linux/macOS support and testing (currently Windows-focused)

### Clipboard
- [x] Copy buttons on code blocks, bash output, diffs, file ops, thinking blocks

## Feature Requests

### Input & UX
- [x] Auto-grow input with max height and manual resize
- [ ] Markdown rendering in input (preview mode)
- [x] Context length indicator (token usage / remaining)
- [ ] Drag and drop (files, images into prompt)
- [ ] Image attachments in messages (paste/drop, up to 8 per turn, pass as base64)

### Agent Capabilities
- [ ] `/rewind` — Roll back to a previous message checkpoint, restoring files on disk (SDK: `query.rewindFiles()`). See `docs/rewind-plan.md`
- [ ] `/btw` — Ephemeral side question that doesn't enter conversation history. Runs while agent is working, no tool access, shows in dismissible overlay. No SDK support — needs separate `query()` call with `maxTurns: 1`
- [ ] Commands (slash commands for common actions)
- [ ] Skills (reusable prompt templates / workflows)
- [ ] MCP server connections (connect to external MCP servers)

### Git & Workflow
- [ ] Branch → PR link (create PR from session branch)
- [x] Branch without worktree (use existing checkout, no worktree creation)
- [ ] Stacked branch workflows (dependent branch chains)

### Configuration
- [ ] Customizable keybindings (`~/.grove-bench/keybindings.json`)
- [ ] Project scripts (user-defined scripts bound to keyboard shortcuts)

### Dev & Preview
- [ ] Localhost run (start/preview dev server from worktree)

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
