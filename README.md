# Grove Bench

Multi-agent git worktree orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). A Windows-native Electron desktop app that manages concurrent AI coding conversations, each in an isolated git worktree with a dedicated PTY terminal.

## Features

- **Concurrent conversations** — Run multiple Claude Code instances in parallel, one per conversation, each in its own git worktree
- **Isolated worktrees** — Every conversation gets a dedicated worktree so agents never conflict
- **Integrated terminal** — Built-in xterm.js terminals with full PTY support
- **Conversation management** — Start, monitor, and stop conversations across projects from a single UI
- **Project memory** — Persistent notes per project, shared across conversations

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
| `npm run dist` | Build distributable installer |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Run tests with coverage |

## License

MIT
