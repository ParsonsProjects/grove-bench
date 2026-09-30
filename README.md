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

## Installing

Download `Grove-Bench-Setup-<version>.exe` from [Releases](https://github.com/ParsonsProjects/grove-bench/releases). The installer is not code signed yet, so Windows SmartScreen shows "Windows protected your PC" on first run: choose **More info**, then **Run anyway**. After that, the app checks for new releases and offers the update in the title bar.

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
| `npm run dist` | Build the Windows installer into `out/` |
| `npm run typecheck` | Type check the TypeScript and the Svelte components |
| `npm test` | Run all tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Run tests with coverage |

## License

[FSL-1.1-MIT](./LICENSE) (Functional Source License). You can use, change and share Grove Bench for any purpose except offering it in a competing commercial product or service. Each release becomes available under the MIT License two years after it comes out.

Code published before this change, including releases up to `v0.0.0-alpha.2`, stays available under the MIT License.
