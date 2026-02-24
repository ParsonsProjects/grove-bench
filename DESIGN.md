# Grove Bench - Multi-Agent Git Worktree Orchestrator

> Design Document v0.3
>
> v0.3 changes: Switched UI framework from React to Svelte 5. Replaced React hooks with Svelte stores and actions. Updated project structure and dependencies accordingly.
>
> v0.2 changes: Fixed fabricated CLAUDE_CODE_PROJECT_DIR env var with real Claude Code config. Added worktree dependency/config file handling (Section 6). Replaced simple-git with execa + git CLI. Added Windows file locking handling to cleanup flows. Switched to short IDs for PATH_MAX safety. Added git version check and shell detection. Added error handling strategy (Section 13). Pinned Electron version.

## 1. Problem Statement

Running multiple AI coding agents (starting with Claude Code) on the same repository requires manual git worktree setup, multiple terminal windows, and careful branch management. There's no unified Windows-native tool that handles worktree lifecycle and provides a multi-pane terminal environment for parallel agent work.

## 2. Goals (v1)

- Electron app for Windows that manages up to 3 concurrent agent sessions
- Automatic git worktree creation and cleanup per agent
- Each agent gets a real interactive terminal (PTY) scoped to its worktree
- Soft directory scoping so agents stay within their worktree (ergonomic safety net, not a hard sandbox)
- Ephemeral sessions (no state persistence across app restarts)
- Support Claude Code as the first (and only v1) agent

## 3. Non-Goals (v1)

- Cross-platform (macOS/Linux) support
- Task orchestration, auto-assignment, or GitHub issue integration
- Built-in diff viewer
- Session persistence or reconnection
- Support for agents other than Claude Code
- Container-based sandboxing

## 4. Architecture

### 4.1 Process Model

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  AgentSession │  │  AgentSession │  │  AgentSession │  │
│  │  - node-pty   │  │  - node-pty   │  │  - node-pty   │  │
│  │  - worktree   │  │  - worktree   │  │  - worktree   │  │
│  │  - branch     │  │  - branch     │  │  - branch     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│  ┌──────┴─────────────────┴─────────────────┴───────┐   │
│  │              WorktreeManager (execa + git CLI)    │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │              IPC Bridge (contextBridge)            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │              │              │
          ▼              ▼              ▼
┌─────────────────────────────────────────────────────────┐
│                  Electron Renderer Process               │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  TerminalPane │  │  TerminalPane │  │  TerminalPane │  │
│  │  (xterm.js)   │  │  (xterm.js)   │  │  (xterm.js)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Sidebar / Controls                    │   │
│  │  - Repo selector                                  │   │
│  │  - New agent button                               │   │
│  │  - Active agents list                             │   │
│  │  - Agent status indicators                        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Key Components

#### WorktreeManager

Responsible for all git worktree operations. Uses `execa` to call the `git` CLI directly (simpler and lighter than `simple-git`, which would only be used via `.raw()` anyway).

```typescript
interface WorktreeConfig {
  repoPath: string;       // absolute path to the main repo
  branchName: string;     // branch to create for the worktree
  baseBranch?: string;    // branch to base off (default: current HEAD)
}

interface WorktreeInfo {
  id: string;             // short unique id (8 chars, e.g. "a3f8b2c1")
  path: string;           // absolute path to worktree directory
  branch: string;         // branch name
  repoPath: string;       // parent repo path
  createdAt: number;      // timestamp
}

class WorktreeManager {
  // Creates worktree at <repoPath>/.grove-wt/<short-id>/
  async create(config: WorktreeConfig): Promise<WorktreeInfo>;

  // Removes worktree with Windows-safe retry logic (see Section 7.2)
  async remove(id: string, deleteBranch?: boolean): Promise<void>;

  // Lists all grove-bench-managed worktrees for a repo
  async list(repoPath: string): Promise<WorktreeInfo[]>;

  // Cleans up all grove-bench worktrees (called on app quit)
  async cleanupAll(): Promise<void>;

  // Validates that a path is a git repo
  async validateRepo(path: string): Promise<boolean>;

  // Copies untracked files (.env, etc.) from main checkout to worktree
  async copyUntrackedFiles(worktreeId: string, files: string[]): Promise<void>;
}
```

**Worktree location strategy:**

Worktrees are created inside `<repoPath>/.grove-wt/<short-id>/` where `short-id` is the first 8 characters of a UUID. The short directory name (`.grove-wt` instead of `.grove-worktrees`) and truncated IDs help avoid Windows' 260-character PATH_MAX limit, which is a real concern when combined with deep `node_modules` paths. The `.grove-wt` directory should be added to `.gitignore` (the app can do this automatically).

Alternative considered: `%APPDATA%/grove-bench/worktrees/` -- rejected because worktrees perform better when they're on the same filesystem as the repo, and it's easier to reason about where they are.

Alternative considered: Full UUIDs as directory names -- rejected because a path like `C:\Users\username\Documents\Projects\my-app\.grove-worktrees\550e8400-e29b-41d4-a716-446655440000\node_modules\@scope\package\dist\index.js` easily exceeds 260 characters. 8-char IDs give us 16^8 (4 billion) unique values, more than enough for 3 concurrent sessions.

#### AgentSessionManager

Manages the lifecycle of individual agent sessions (PTY + worktree pairing).

```typescript
interface AgentSession {
  id: string;
  worktree: WorktreeInfo;
  pty: IPty;              // node-pty instance
  status: 'starting' | 'running' | 'stopped' | 'error';
  agentType: 'claude-code'; // extensible later
}

interface CreateSessionOpts {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
}

class AgentSessionManager {
  private sessions: Map<string, AgentSession>;
  private readonly MAX_SESSIONS = 3;

  async createSession(opts: CreateSessionOpts): Promise<AgentSession>;
  async destroySession(id: string): Promise<void>;
  async destroyAll(): Promise<void>;

  // Write user input to the agent's PTY
  write(id: string, data: string): void;

  // Resize the agent's PTY
  resize(id: string, cols: number, rows: number): void;

  // Subscribe to PTY output
  onData(id: string, callback: (data: string) => void): void;
}
```

#### IPC Layer

Electron's contextBridge exposes a safe API to the renderer. No direct access to Node APIs from the renderer.

```typescript
// preload.ts — exposed via contextBridge
interface GroveBenchAPI {
  // Repo operations
  selectRepo(): Promise<string | null>;          // opens native folder picker
  validateRepo(path: string): Promise<boolean>;

  // Session operations
  createSession(opts: CreateSessionOpts): Promise<{ id: string; branch: string }>;
  destroySession(id: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;

  // Terminal I/O
  termWrite(sessionId: string, data: string): void;
  termResize(sessionId: string, cols: number, rows: number): void;
  onTermData(sessionId: string, callback: (data: string) => void): () => void;
  offTermData(sessionId: string): void;  // explicit cleanup alternative

  // App lifecycle
  onAppClosing(callback: () => void): void;
}
```

**Note on IPC cleanup:** The `onTermData` return value (a cleanup function) works because the closure is created inside the preload script, which runs in the renderer's JS context. `contextBridge.exposeInMainWorld` correctly proxies returned functions. However, as a safety net, `offTermData` provides an explicit cleanup path that doesn't rely on return value proxying. The `TerminalPane` component should call `offTermData` in its `onDestroy` lifecycle.

### 4.3 Renderer / UI

Svelte 5 app with a simple layout:

```
┌─────────────────────────────────────────────────────┐
│  [Repo: ~/projects/my-app]  [+ New Agent]           │
├──────────┬──────────┬──────────┬────────────────────┤
│  Agents  │          │          │                    │
│          │ Terminal 1│ Terminal 2│ Terminal 3        │
│  ● auth  │          │          │                    │
│  ● api   │ claude   │ claude   │ claude             │
│  ○ (add) │          │          │                    │
│          │          │          │                    │
│          │          │          │                    │
│          │          │          │                    │
└──────────┴──────────┴──────────┴────────────────────┘
```

Panes are resizable. Clicking an agent in the sidebar focuses its terminal. Panes can be toggled between split and tabbed view.

UI dependencies:
- Svelte 5 (with runes for reactivity)
- xterm.js + @xterm/addon-fit + @xterm/addon-web-links
- svelte-splitpanes (for resizable split panes)
- Tailwind CSS (utility-first, no component library bloat)

**Why Svelte over React:** The renderer UI is thin (sidebar, terminal panes, dialogs, toasts). Svelte's lighter approach is a better fit: no virtual DOM overhead, less boilerplate, and xterm.js lifecycle management is cleaner as a Svelte action than a React hook with `useEffect` cleanup. Svelte 5's runes (`$state`, `$derived`, `$effect`) give us fine-grained reactivity without the `useState`/`useCallback` ceremony.

**xterm.js as a Svelte action:**

```typescript
// actions/terminal.ts
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';

export function terminal(node: HTMLElement, sessionId: string) {
  const term = new Terminal({ cursorBlink: true, fontSize: 14 });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(node);
  fitAddon.fit();

  // Wire up IPC
  term.onData((data) => window.groveBench.termWrite(sessionId, data));
  const cleanup = window.groveBench.onTermData(sessionId, (data) => term.write(data));

  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    window.groveBench.termResize(sessionId, term.cols, term.rows);
  });
  resizeObserver.observe(node);

  return {
    destroy() {
      cleanup();
      window.groveBench.offTermData(sessionId);
      resizeObserver.disconnect();
      term.dispose();
    }
  };
}
```

Usage in a component is then just `<div use:terminal={session.id}></div>`, which is considerably cleaner than the React equivalent.

**Build tooling note:** Electron Forge supports Vite via `@electron-forge/plugin-vite`. The Svelte renderer compiles through Vite using `@sveltejs/vite-plugin-svelte`. The main process stays plain TypeScript compiled by Vite's Node target. An alternative is `electron-vite` which is purpose-built for Electron + Vite, but Forge has broader ecosystem support and better packaging/distribution out of the box.

## 5. Sandboxing Strategy

### 5.1 Worktree Isolation (Structural)

Each agent operates on its own git branch in its own worktree directory. This means:
- File changes in one agent's worktree don't appear in another's
- Each agent has its own working tree state
- Merging happens explicitly through git, not accidentally

### 5.2 Directory Scoping (Soft Enforcement)

Claude Code uses the shell's current working directory (`cwd`) as its project directory. By spawning each agent's shell with `cwd` set to the worktree path, Claude Code naturally scopes itself to that directory.

Additional layers of soft enforcement:

**Layer 1: `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`**

This env var tells Claude Code to reset the working directory back to the project root after each bash command. It discourages agents from `cd`-ing outside their worktree, though it doesn't prevent it completely.

**Layer 2: Per-worktree `.claude/settings.local.json`**

When creating a worktree, the app generates a `.claude/settings.local.json` file that denies read/write access outside the worktree:

```json
{
  "permissions": {
    "deny": [
      "Read(../../**)",
      "Edit(../../**)"
    ]
  }
}
```

This uses Claude Code's built-in permission system. It's not a hard sandbox — Claude Code could still execute arbitrary shell commands that touch files outside the worktree — but it prevents Claude's own file operations from accidentally reaching into other worktrees or the main checkout.

**Layer 3: Claude Code's interactive permission model**

Claude Code already prompts the user before performing file operations and shell commands. This acts as a human-in-the-loop check.

**Honesty note:** This is soft scoping, not a hard sandbox. A determined agent (or a prompt injection) could theoretically bypass these restrictions via raw shell commands. For the target use case (your own team running trusted agents on your own code), this is sufficient. For stronger isolation, see Docker-based sandboxing in v2 considerations.

### 5.3 What This Sandboxing Actually Protects Against

To be clear: this is an **ergonomic safety net**, not a security boundary. The goal is preventing accidental cross-contamination between parallel agents, not defending against malicious actors.

What it prevents:
- Agent A accidentally editing files that Agent B is working on
- An agent modifying the main checkout while you're working in it
- Agents stepping on each other's branches or working trees
- Accidental file operations outside the intended worktree scope

What it does NOT prevent:
- Arbitrary shell commands (Claude Code can run them by design — that's the point)
- Network access (agents can fetch packages, hit APIs, etc.)
- A malicious prompt injection that explicitly tells the agent to escape its directory

If stronger isolation is needed later, the path is Docker containers per agent (v2 consideration).

## 6. Worktree Dependency & Config File Handling

Git worktrees only contain tracked files. When creating a new worktree for a Node.js project, the following will be missing:
- `node_modules/` (all dependencies)
- `.env`, `.env.local` and similar untracked config files
- Build output (`dist/`, `.next/`, etc.)
- Any other gitignored files the project depends on

### 6.1 Dependencies (node_modules)

**v1 approach: Let the agent handle it.**

The agent's first task in a new worktree will often require running `npm install` (or `pnpm install`, `yarn`, etc.). This is the simplest approach and avoids complexity in v1. The tradeoff is slower session startup, especially for large projects.

The "New Agent" dialog should display a note: "New worktrees don't include node_modules. Your agent may need to run `npm install` before starting work."

**Future improvements (v2):**
- Detect the project's package manager and auto-run install after worktree creation
- If the team uses `pnpm`, its content-addressable store means installs are near-instant and deduped on disk, so this is a solved problem
- Symlink `node_modules` from the main checkout (fast, zero disk cost, but risky if agents install different packages)

### 6.2 Untracked Config Files (.env, etc.)

**v1 approach: Auto-copy a configurable list of files.**

The app maintains a per-repo config (stored in `.grove-wt/config.json`) that specifies which untracked files to copy from the main checkout into new worktrees:

```json
{
  "copyFiles": [".env", ".env.local", ".env.development"],
  "copyDirs": []
}
```

On first use for a repo, the app scans for common untracked config files (`.env*`, `.npmrc`, `.nvmrc`) and suggests them. The user can edit this list in the settings.

```typescript
interface WorktreeRepoConfig {
  copyFiles: string[];     // files to copy from main checkout
  copyDirs: string[];      // directories to copy (e.g. ".vscode/")
}
```

The `WorktreeManager.create()` method copies these files after creating the worktree.

### 6.3 Why Not Symlink Everything?

Symlinks are tempting but cause real problems:
- `node_modules` symlinks break when agents install different packages (one agent adds a dep, another can't find it)
- Some tools (especially on Windows) don't follow symlinks reliably
- Symlinked `.env` means all agents share the same config, which may not be desired if agents need different `PORT` values

For v1, explicit file copying is safer and more predictable.

## 7. Agent Lifecycle

### 7.1 Creating a Session

```
User clicks "+ New Agent"
  → Prompt for branch name (auto-suggest based on convention, e.g. "agent/feature-name")
  → WorktreeManager.create() -- creates branch + worktree directory
    → Auto-add .grove-wt to .gitignore if not present
    → Copy untracked files (.env, etc.) from main checkout per repo config
    → Generate .claude/settings.local.json with directory-scoped deny rules
  → AgentSessionManager.createSession()
    → Verify git meets minimum version (2.17+)
    → Verify claude CLI is available (where.exe claude)
    → Detect preferred shell (pwsh > powershell > cmd)
    → Spawn node-pty with cwd = worktree path
    → Connect PTY output to renderer via IPC
  → New terminal pane appears in UI
  → User interacts directly with Claude Code in the terminal
```

### 7.2 Destroying a Session

```
User clicks "X" on agent pane OR closes app
  → AgentSessionManager.destroySession()
    → Send SIGTERM to PTY (on Windows: pty.kill())
    → Wait up to 5 seconds for graceful exit
    → Force kill if still running
    → Wait 500ms for Windows file handles to release
  → Prompt: "Delete branch <branch-name>?" (default: yes for clean branches, no if commits exist)
  → WorktreeManager.remove()
    → Try: git worktree remove <path>
    → If EACCES/EPERM: git worktree remove --force <path>
    → If still fails: fs.rm(path, {recursive: true, force: true}) then git worktree prune
    → If even that fails: log warning, flag for manual cleanup on next startup
    → Optionally: git branch -d <branch>
```

### 7.3 App Shutdown

```
App close event (before-quit)
  → AgentSessionManager.destroyAll()
    → Kill all PTYs
    → Wait 500ms for Windows file handle release
  → WorktreeManager.cleanupAll()
    → Remove all grove-bench-managed worktrees (with retry logic per Section 7.2)
    → Optionally delete orphaned branches
    → git worktree prune (clean up any stale references)
  → App exits
```

## 8. Technical Considerations

### 8.1 node-pty on Windows

`node-pty` uses Windows ConPTY (available since Windows 10 1809). Key points:

- **Native module rebuild**: node-pty is a native Node addon. It must be rebuilt for Electron's Node version using `electron-rebuild` or `@electron/rebuild`.
- **Shell selection**: Should detect the best available shell rather than hardcoding. See shell detection below.
- **ConPTY quirks**: ConPTY can have rendering issues with certain escape sequences. xterm.js handles most of these, but testing is needed with Claude Code's specific output (spinner animations, syntax highlighting, etc.).

**Shell detection (priority order):**

```typescript
async function detectShell(): Promise<string> {
  const candidates = ['pwsh.exe', 'powershell.exe', 'cmd.exe'];
  for (const shell of candidates) {
    try {
      await execAsync(`where.exe ${shell}`);
      return shell;
    } catch {
      continue;
    }
  }
  return 'cmd.exe'; // fallback, always present on Windows
}
```

`pwsh.exe` (PowerShell 7+) is preferred over `powershell.exe` (Windows PowerShell 5.1) because it has better UTF-8 support, faster startup, and more consistent behaviour. Users can override this in app settings.

**Spawning the PTY:**

```typescript
import { spawn } from 'node-pty';

const shell = await detectShell();

const pty = spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: worktreePath,
  env: {
    ...process.env,
    // Keeps Claude Code from cd-ing away from the worktree after each command
    CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
  },
});
```

**Open question:** Should we spawn Claude Code directly (`spawn('claude', [], ...)`) or spawn a shell and let the user invoke claude themselves? Direct spawn is simpler but less flexible. Shell spawn lets users run git commands, install packages, etc. alongside claude.

**Recommendation:** Spawn a shell. Users may want to run other commands in the same terminal (e.g. `npm install` before starting claude). The worktree is the sandbox, not the process.

### 8.2 xterm.js Integration

xterm.js in the renderer communicates with node-pty in the main process via IPC:

```
Renderer                    Main Process
xterm.onData(data) ──IPC──> pty.write(data)     (user types)
xterm.write(data)  <──IPC── pty.onData(data)    (agent outputs)
FitAddon.fit()     ──IPC──> pty.resize(cols,rows) (terminal resizes)
```

**Performance note:** Terminal output can be very high throughput (e.g. `cat` a large file). The IPC channel needs to handle this without dropping data or freezing the UI. Electron's IPC is async and handles this reasonably well, but we should:
- Batch rapid PTY output before sending to renderer (debounce at ~16ms / 1 frame)
- Use `ipcRenderer.on` (not `ipcRenderer.invoke`) for streaming data

### 8.3 Git Operations via execa

We use `execa` to call the `git` CLI directly rather than `simple-git`. The reason: `simple-git` doesn't have native worktree methods, so every call would be `git.raw()` anyway. Direct `execa` calls are lighter, have fewer dependencies, and avoid native module rebuild issues.

```typescript
import { execa } from 'execa';

async function git(args: string[], cwd: string) {
  const result = await execa('git', args, { cwd });
  return result.stdout;
}

// Create worktree with new branch
await git(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], repoPath);

// Remove worktree (with force fallback for Windows file locking)
try {
  await git(['worktree', 'remove', worktreePath], repoPath);
} catch {
  await git(['worktree', 'remove', '--force', worktreePath], repoPath);
}

// List worktrees
const output = await git(['worktree', 'list', '--porcelain'], repoPath);

// Prune stale worktree entries
await git(['worktree', 'prune'], repoPath);

// Check git version
const version = await git(['--version'], repoPath);
// Parses "git version 2.43.0.windows.1" -> [2, 43, 0]
```

**Edge case:** If the app crashes without cleaning up, worktrees are left behind. On next launch, we should detect orphaned `.grove-wt` directories and offer to clean them up.

**Edge case:** Git prevents checking out the same branch in two worktrees. The app must enforce unique branch names per agent session.

### 8.4 Prerequisite Detection

Before spawning a session, verify that required tools are available:

**Git availability and version:**

```typescript
async function checkGit(): Promise<{ available: boolean; version?: string; meetsMinimum?: boolean }> {
  try {
    const { stdout } = await execAsync('git --version');
    // stdout: "git version 2.43.0.windows.1"
    const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return { available: true, meetsMinimum: false };
    const [major, minor] = [parseInt(match[1]), parseInt(match[2])];
    // Require git 2.17+ for reliable worktree support on Windows
    return { available: true, version: stdout.trim(), meetsMinimum: major > 2 || (major === 2 && minor >= 17) };
  } catch {
    return { available: false };
  }
}
```

If git is not found or below 2.17, show a blocking error. Git 2.5 introduced worktrees, but 2.17+ has important Windows fixes and `git worktree move` support.

**Claude Code availability:**

```typescript
async function findClaudeCode(): Promise<string | null> {
  try {
    // where.exe is the Windows equivalent of which
    const { stdout } = await execAsync('where.exe claude');
    return stdout.trim().split('\n')[0]; // first match
  } catch {
    return null;
  }
}
```

If not found, show a helpful error: "Claude Code not found. Install it with `npm install -g @anthropic-ai/claude-code`" (or whatever the current install method is -- verify at build time).

**All prerequisite checks should run once at app startup** and again when the user tries to create a session. Results are cached until the app restarts.

## 9. Project Structure

```
grove-bench/
├── package.json
├── tsconfig.json
├── svelte.config.js             # Svelte config
├── vite.config.ts               # Vite config (Svelte uses Vite)
├── forge.config.ts              # electron-forge config
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # app entry point
│   │   ├── ipc.ts               # IPC handler registration
│   │   ├── git.ts               # typed git CLI wrapper (execa)
│   │   ├── worktree-manager.ts
│   │   ├── agent-session.ts
│   │   ├── prerequisites.ts     # git/claude detection & version checks
│   │   ├── shell-detect.ts      # preferred shell detection
│   │   └── preload.ts           # contextBridge definitions
│   ├── renderer/                # Svelte UI
│   │   ├── index.html
│   │   ├── main.ts              # Svelte app entry
│   │   ├── App.svelte
│   │   ├── components/
│   │   │   ├── Sidebar.svelte
│   │   │   ├── TerminalPane.svelte
│   │   │   ├── NewAgentDialog.svelte
│   │   │   ├── RepoSelector.svelte
│   │   │   ├── ErrorToast.svelte
│   │   │   └── PrerequisiteCheck.svelte
│   │   ├── actions/
│   │   │   └── terminal.ts      # xterm.js Svelte action
│   │   ├── stores/
│   │   │   └── sessions.ts      # session state (Svelte writable store)
│   │   └── styles/
│   │       └── globals.css      # Tailwind imports
│   └── shared/                  # Types shared between main/renderer
│       └── types.ts
├── .gitignore
└── README.md
```

## 10. Dependencies

### Production
| Package | Purpose | Notes |
|---------|---------|-------|
| electron | App shell | Pin to v33.x (test node-pty compat before upgrading) |
| node-pty | PTY for terminals | Native module, needs rebuild for Electron |
| xterm | Terminal emulator UI | v5+ |
| @xterm/addon-fit | Auto-resize terminal | |
| @xterm/addon-web-links | Clickable URLs in terminal | |
| execa | Git CLI wrapper | Lightweight, no native modules |
| svelte | UI framework | v5 (with runes) |
| svelte-splitpanes | Resizable split panes | |

### Development
| Package | Purpose |
|---------|---------|
| @electron-forge/cli | Build tooling |
| @electron-forge/plugin-vite | Vite integration for Forge |
| @electron/rebuild | Native module rebuild |
| @sveltejs/vite-plugin-svelte | Svelte + Vite integration |
| vite | Bundler for renderer |
| typescript | |
| tailwindcss | Styling |
| eslint | Linting |

Note: `uuid` was removed. We use `crypto.randomUUID().slice(0, 8)` for short IDs, which is built into Node.js.

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| node-pty fails to rebuild for Electron | Medium | High (blocks everything) | Test early. Fallback: raw child_process with manual ANSI handling (worse UX) |
| ConPTY rendering glitches with Claude Code output | Medium | Low (cosmetic) | Test Claude Code's spinner/color output. xterm.js handles most edge cases |
| Worktree cleanup fails on crash | High | Medium (disk clutter, git state) | Orphan detection on startup. Retry logic with force removal. Manual cleanup instructions in README |
| Windows file locking prevents worktree deletion | High | Medium (stuck worktrees) | Kill PTY + 500ms delay + force remove + fs.rm fallback + git worktree prune |
| Claude Code not installed on user's machine | High | Medium (dead feature) | Detection + clear install instructions at session creation time |
| Git not installed or too old | Medium | High (blocks everything) | Check at startup, require 2.17+. Clear error message with install link |
| Git worktree branch conflicts | Low | Medium | Enforce unique branch naming. Validate before creation |
| High memory usage with 3 xterm instances | Low | Low | xterm.js is lightweight. node-pty processes are the main cost |
| Claude Code changes its CLI interface | Medium | High | Abstract the agent spawn config. Pin to known-good version in docs |
| PATH_MAX exceeded on Windows | Medium | Medium (broken dependencies) | Short IDs (8 chars), short dir name (.grove-wt), document as requirement |
| Missing node_modules in worktrees confuses users | High | Low (expected, documented) | Display note in "New Agent" dialog. Agent can npm install as first step |
| Missing .env files break agent workflow | High | Medium | Auto-copy configurable untracked files from main checkout |

## 12. Open Questions

1. **Branch naming convention**: Auto-generate (e.g. `grove/agent-1-<timestamp>`) or let users pick? Recommendation: let users pick with auto-suggest.
2. **Worktree base branch**: Always branch from `main`/`master`, or let users choose? Recommendation: default to current HEAD, allow override.
3. **Agent type config**: Even though v1 is Claude Code only, should the data model support an `agentType` field now for forward compatibility? Recommendation: yes, it's cheap.
4. **Telemetry**: Any usage tracking? Recommendation: no, this is an internal tool.

## 13. Error Handling Strategy

The app needs to surface errors clearly since things will go wrong (worktree creation fails, PTY crashes, git conflicts, etc.).

### 13.1 Error Categories

| Category | Example | How it surfaces |
|----------|---------|-----------------|
| Prerequisite failure | Git not found, Claude Code missing, git too old | Blocking dialog on startup or session creation. Cannot proceed. |
| Worktree creation failure | Branch already exists, disk full, permission denied | Error toast + details. Session creation aborted, no terminal opens. |
| PTY crash | Claude Code exits unexpectedly, shell crashes | Terminal shows exit message in red. Agent status changes to "stopped". User can destroy and recreate. |
| Worktree cleanup failure | File locked by another process | Warning toast. Retry button. Flag for cleanup on next startup. |
| IPC error | Message serialization failure | Log to console. Should be rare, indicates a bug. |

### 13.2 UI Elements

- **Status bar** at the bottom of each terminal pane showing agent status (running/stopped/error)
- **Toast notifications** for non-blocking errors (worktree cleanup issues, background warnings)
- **Modal dialogs** for blocking errors (prerequisites missing, can't create session)
- **Terminal inline messages** for PTY-level events (process exited, connection lost)

### 13.3 Logging

All errors log to a file at `%APPDATA%/grove-bench/logs/`. Useful for debugging when things go wrong. Log rotation: keep last 5 files, max 10MB each.

## 14. v2 Considerations (Out of Scope, Documented for Later)

- Support for Codex, Gemini CLI, Aider, and other agents
- Built-in diff viewer (compare agent branches against base)
- Session persistence and reconnection
- Task orchestration (assign GitHub issues to agents)
- Docker-based sandboxing
- Cross-platform support (macOS, Linux)
- Shared CLAUDE.md / agent instructions per worktree
- Agent-to-agent communication (one agent's output feeds another)
- Git operations UI (merge, rebase, cherry-pick between agent branches)
