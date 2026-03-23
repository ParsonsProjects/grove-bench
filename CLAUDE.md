# Grove Bench

Multi-agent git worktree orchestrator for Claude Code. Windows-native Electron desktop app that manages concurrent AI coding sessions, each in an isolated git worktree with a dedicated PTY terminal.

## Tech Stack

- **Runtime:** Electron 33 (main + renderer process)
- **UI:** Svelte 5, Tailwind CSS v4, Bits UI, xterm.js
- **Backend:** Node.js, node-pty, execa (git CLI), Zod
- **Build:** Vite, Electron Forge (Squirrel Windows installer)
- **Tests:** Vitest, Testing Library (Svelte), jsdom
- **Language:** TypeScript 5.7

## Project Structure

```
src/
  main/               # Electron main process
    index.ts           # App entry point
    preload.ts         # Context bridge (IPC exposure)
    ipc.ts             # IPC handler registration
    git.ts             # Git CLI wrapper (execa)
    worktree-manager.ts
    agent-session.ts   # Session lifecycle management
    agent-utils.ts     # Agent helper utilities
    terminal.ts        # node-pty management
    app-state.ts       # Persistent app state
    window-state.ts    # Window position/size persistence
    memory.ts          # Project memory system
    memory-autosave.ts # Auto-save memory on interval
    settings.ts        # User settings
    prerequisites.ts   # Git/Claude detection & version checks
    logger.ts          # File-based logging
    dev-server.ts      # Dev server management
    dev-command-detector.ts
    git-status-parser.ts
    port-killer.ts
    adapters/          # Agent adapter pattern
      index.ts         # Adapter exports
      types.ts         # Adapter interfaces
      registry.ts      # Adapter registry
      claude-code.ts   # Claude Code adapter implementation
  renderer/            # Electron renderer (Svelte UI)
    App.svelte         # Root component
    main.ts            # Renderer entry
    components/        # Svelte components (~34 files)
    lib/               # Utilities
    stores/            # Svelte stores (sessions, messages, settings, etc.)
    styles/            # CSS
  shared/
    types.ts           # Shared types between main/renderer
docs/                  # Design docs, user stories
DESIGN.md              # Architecture & design document
TODO.md                # Gap analysis vs competitors
```

## Config Files

- `forge.config.mjs` — Electron Forge config
- `vite.main.config.mjs` — Vite config for main process
- `vite.renderer.config.mjs` — Vite config for renderer
- `vite.preload.config.mjs` — Vite config for preload script
- `vitest.config.mts` — Test config (projects: main, renderer)
- `svelte.config.mjs` — Svelte compiler config

## Commands

```bash
npm start              # Run in dev mode (electron-forge start)
npm run package        # Package the app
npm run make           # Build distributable installer
npm test               # Run all tests (vitest run)
npm run test:watch     # Watch mode
npm run test:coverage  # Run tests with coverage
npm run test:main      # Tests for main process only
npm run test:renderer  # Tests for renderer only
```

## Architecture Notes

- Main process manages AgentSessions, each with a node-pty instance and git worktree
- IPC bridge via Electron contextBridge (preload.ts)
- Git operations use `execa` calling `git` CLI directly (not simple-git)
- Multiple concurrent agent sessions per repository
- Worktrees stored in a managed directory with short IDs (PATH_MAX safety)
- Windows-only (no cross-platform support in v1)

## Key Dependencies

- `@anthropic-ai/claude-agent-sdk` — Claude Code agent integration
- `@xterm/xterm` — Terminal emulation in renderer
- `node-pty` — PTY spawning in main process
- `bits-ui` — UI component library
- `diff` — Diff computation for file changes
- `marked` + `highlight.js` + `dompurify` — Markdown rendering with syntax highlighting
- `fuse.js` — Fuzzy search
- `tailwind-merge` + `tailwind-variants` — Tailwind utility helpers
- `zod` — Schema validation
- `execa` — Git CLI wrapper
