# Grove Bench

Multi-agent git worktree orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). A Windows-native Electron desktop app that manages concurrent AI coding sessions, each in an isolated git worktree with a dedicated PTY terminal.

## Features

- **Concurrent agent sessions** — Run multiple Claude Code instances in parallel, each in its own git worktree
- **Isolated worktrees** — Every session gets a dedicated worktree so agents never conflict
- **Integrated terminal** — Built-in xterm.js terminals with full PTY support
- **Session management** — Start, monitor, and stop agent sessions from a single UI
- **Project memory** — Persistent memory system across sessions

## Tech Stack

Electron · Svelte 5 · Tailwind CSS v4 · TypeScript · node-pty · xterm.js

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm start
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run in dev mode |
| `npm run make` | Build distributable installer |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Run tests with coverage |

## License

MIT
