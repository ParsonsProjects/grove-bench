# Grove Bench

Multi-agent git worktree orchestrator for Claude Code. Windows-native Electron desktop app that manages concurrent AI coding sessions, each in an isolated git worktree with a dedicated PTY terminal.

## Tech Stack

- **Runtime:** Electron 33 (main + renderer process)
- **UI:** Svelte 5, Tailwind CSS v4, Bits UI, xterm.js
- **Backend:** Node.js, node-pty, execa (git CLI), Zod
- **Build:** Vite, electron-builder (NSIS Windows installer)
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
    session-*.ts       # Session types, event log + history, permission prompts, skills, agent config
    agent-utils.ts     # Agent helper utilities
    terminal.ts        # node-pty management
    app-state.ts       # Persistent app state
    window-state.ts    # Window position/size persistence
    memory.ts          # Project memory system
    memory-autosave.ts # Auto-save memory on interval
    settings.ts        # User settings
    prerequisites.ts   # Git/Claude detection & version checks
    credentials.ts     # Encrypted API key storage (safeStorage)
    logger.ts          # File-based logging
    freeze-log.ts      # Main-process stalls, slow window frames (100 ms+), process launch timing
    perf-*.ts          # performance.log, step timings (new/resume/wake), health line, traces
    git-status-parser.ts
    preview.ts         # Preview tab: your page (WebContentsView) + the agent's (offscreen)
    preview-*.ts       # Preview URL rules, console log, in-page scripts, keys
    adapters/          # Agent adapter pattern
      index.ts         # Adapter exports
      types.ts         # Adapter interfaces
      registry.ts      # Adapter registry
      claude-code.ts   # Claude Code adapter implementation
      acp/             # Agent Client Protocol adapter (Gemini CLI, Copilot CLI, custom agents)
      grove-tools.ts   # Grove's memory and Preview tools, defined once
      grove-mcp-http.ts # Those tools over MCP HTTP, for agents other than Claude Code
      mcp-bridge/      # stdio bridge to that server, for agents without HTTP MCP (2nd Vite entry)
      preview-mcp-server.ts # Agent browser tools (grove-preview)
  renderer/            # Electron renderer (Svelte UI)
    App.svelte         # Root component
    main.ts            # Renderer entry
    components/        # Svelte components (~34 files)
      settings/        # Settings panel sections and shared setting rows
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

- `electron-builder.yml` — electron-builder config (NSIS installer, update feed)
- `vite.main.config.mjs` — Vite config for main process
- `vite.renderer.config.mjs` — Vite config for renderer
- `vite.preload.config.mjs` — Vite config for preload script
- `vitest.config.mts` — Test config (projects: main, renderer)
- `svelte.config.mjs` — Svelte compiler config
- `.npmrc`: npm settings. `min-release-age=7` only installs versions published 7+ days ago; `engine-strict` makes the `engines.npm` range (>=11.10.0, the first npm with that setting) a hard error. `landing/.npmrc` repeats them. `scripts/check-release-age.mjs` checks lockfile changes in the Dependency age workflow

## Commands

```bash
npm start              # Run in dev mode (Vite dev server + Electron)
npm run build          # Build main, preload, and renderer
npm run dist           # Build + package NSIS installer into out/ (unsigned, never publishes)
npm run typecheck      # tsc, then svelte-check for .svelte components (CI runs both)
npm test               # Run all tests (vitest run)
npm run test:watch     # Watch mode
npm run test:coverage  # Run tests with coverage
npm run test:main      # Tests for main process only
npm run test:renderer  # Tests for renderer only
```

## Terminology

User-facing names and internal names differ on purpose:

- **Conversation** (UI, help, docs) = `AgentSession` / `session:*` IPC / `sessions` store in code. Keep "session" internally: it also names the provider's own resumable session (`providerSessionId`).
- **Thread tab** (UI, help, docs) = the `'activity'` workspace tab in code (`WorkspaceTab`, `setActiveTab`), and its view modes are `ActivityViewMode` / `defaultActivityView`. It was called Activity before; the code names stay so saved settings keep working.
- **Project** (UI, help, docs) = `repoPath` in code. Keep "repo" internally: `'project'` is already a Claude Code config scope (`'project' | 'user' | 'local'`) for MCP servers, skills and plugins.

Use the user-facing words in any new UI text, help page or doc. See `docs/projects-plan.md` for where projects are heading.

## Architecture Notes

- Main process manages AgentSessions, each with a node-pty instance and git worktree
- IPC bridge via Electron contextBridge (preload.ts)
- Git operations use `execa` calling `git` CLI directly (not simple-git)
- Multiple concurrent agent sessions per repository
- Worktrees stored in a managed directory with short IDs (PATH_MAX safety)
- Windows-only (no cross-platform support in v1)
- Adapters describe tool calls with a provider-neutral `ToolView`
  (`src/shared/tool-view.ts`); the UI and Read-safe mode read that, never a
  provider's tool names. Events without one are read as Claude Code tools
- Panels, dialogs and tabs that open on demand load on first use via
  `lazyComponent` (`src/renderer/lib/lazy-component.ts`), keeping their code
  (and libraries only they use, such as xterm) out of the startup bundle

## Key Dependencies

Vite bundles the renderer and nearly all of the main process, so
`dependencies` in package.json holds only what main loads from
`node_modules` at run time: the agent SDK, `electron-updater` and `node-pty`.
Everything else goes in `devDependencies`, or it ships in the installer
unused. `scripts/smoke-deps.mjs` checks the packaged app (Package workflow).

- `@anthropic-ai/claude-agent-sdk` — Claude Code agent integration
- `@modelcontextprotocol/sdk`: serves Grove's tools over MCP HTTP (bundled)
- `@xterm/xterm` — Terminal emulation in renderer
- `node-pty` — PTY spawning in main process
- `bits-ui` — UI component library
- `diff` — Diff computation for file changes
- `marked` + `highlight.js` + `dompurify` — Markdown rendering with syntax highlighting
- `fuse.js` — Fuzzy search
- `tailwind-merge` + `tailwind-variants` — Tailwind utility helpers
- `zod` — Schema validation
- `execa` — Git CLI wrapper
