# Grove Bench — Gap Analysis vs Toad

Feature gaps identified by comparing against [Toad](https://github.com/batrachianai/toad).

## Priority 1 — High Impact

### Multi-Agent Support
- [ ] Support multiple agent backends (Gemini, Codex, OpenHand) beyond Claude
- [ ] Agent discovery/install marketplace ("app store")
- [ ] Agent Client Protocol for custom agent integration

### Embedded Terminal
- [ ] Full working shell with color support and interactive command execution
- [ ] Persistent shell state (env vars, directory changes across commands)

### Settings UI
- [ ] GUI-based settings panel (no manual JSON editing)
- [ ] Configurable UI layouts (full-featured to minimal)

## Priority 2 — Notable Gaps

### Diff Viewer
- [x] Side-by-side diff view option (toggle in Edit tool header)
- [ ] Syntax highlighting in diff views across multiple languages

### Session Search
- [x] Fuzzy search to find and resume past conversations (Ctrl+R)
- [x] Filter/search within message history (Ctrl+F with highlighting)

### Help System
- [ ] Keybinding documentation (F1 or similar)
- [ ] Context-aware footer showing relevant keyboard shortcuts

## Priority 3 — Nice to Have

### Deployment Options
- [ ] Web mode — serve as browser-accessible app (`grove-bench serve`)
- [ ] Standalone CLI mode without full Electron app

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

### Agent Capabilities
- [ ] Commands (slash commands for common actions)
- [ ] Skills (reusable prompt templates / workflows)
- [ ] MCP server connections (connect to external MCP servers)

### Git & Workflow
- [ ] Branch → PR link (create PR from session branch)
- [ ] Branch without worktree (use existing checkout, no worktree creation)

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
