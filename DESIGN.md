# Grove Bench - Multi-Agent Git Worktree Orchestrator

> Design Document v0.3
>
> v0.3 changes: Switched UI framework from React to Svelte 5. Replaced React hooks with Svelte stores and actions. Updated project structure and dependencies accordingly.
>
> v0.2 changes: Fixed fabricated CLAUDE_CODE_PROJECT_DIR env var with real Claude Code config. Added worktree dependency/config file handling (Section 6). Replaced simple-git with execa + git CLI. Added Windows file locking handling to cleanup flows. Switched to short IDs for PATH_MAX safety. Added git version check and shell detection. Added error handling strategy (Section 13). Pinned Electron version.

## 0. Terminology

This document uses the internal names. In the UI, help pages and user docs the same things are called:

| Internal (this doc, code) | User-facing |
|---|---|
| session, `AgentSession`, `session:*` IPC | conversation |
| repo, `repoPath` | project |

"Session" stays internal because it also names the provider's resumable session (`providerSessionId`). "Project" stays out of the code because Claude Code already uses it as a config scope (`project` / `user` / `local`). The plan for projects that are not a single git repository is in `docs/projects-plan.md`.

## 1. Problem Statement

Running multiple AI coding agents (starting with Claude Code) on the same repository requires manual git worktree setup, multiple terminal windows, and careful branch management. There's no unified Windows-native tool that handles worktree lifecycle and provides a multi-pane terminal environment for parallel agent work.

## 2. Goals (v1)

- Electron app for Windows that manages multiple concurrent agent sessions
- Automatic git worktree creation and cleanup per agent
- Each agent gets a real interactive terminal (PTY) scoped to its worktree
- Soft directory scoping so agents stay within their worktree (ergonomic safety net, not a hard sandbox)
- Session state persistence across app restarts
- Support Claude Code as the first agent, with an adapter pattern for future agents

## 3. Non-Goals (v1)

- Cross-platform (macOS/Linux) support
- Task orchestration, auto-assignment, or GitHub issue integration
- Container-based sandboxing

> **Note:** Several former non-goals have since been implemented: built-in diff viewer (`DiffView.svelte`, `DiffBlock.svelte`), session persistence (`app-state.ts`, `window-state.ts`), an adapter pattern for multiple agent types (`src/main/adapters/`), settings UI, slash commands, MCP server connections, drag-and-drop image attachments, and auto-update (`auto-updater.ts`).

## 4. Architecture

### 4.1 Process Model

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────── ─ ─    │
│  │  AgentSession │  │  AgentSession │  │  ...N sessions │
│  │  - node-pty   │  │  - node-pty   │  │  - node-pty   │
│  │  - worktree   │  │  - worktree   │  │  - worktree   │
│  │  - branch     │  │  - branch     │  │  - branch     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬── ─ ─   │
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
│  ┌──────────────┐  ┌──────────────┐  ┌─────── ─ ─    │
│  │  TerminalPane │  │  TerminalPane │  │  ...N panes    │
│  │  (xterm.js)   │  │  (xterm.js)   │  │  (xterm.js)   │
│  └──────────────┘  └──────────────┘  └─────── ─ ─      │
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

One copy of the app runs at a time (`app.requestSingleInstanceLock()` in `src/main/index.ts`). Every build, the installed app and `npm start` alike, keeps its data in `%APPDATA%\grove-bench`, and two copies would resume the same threads, start a second agent on each transcript and write the same event logs. A second launch hands over to the first, which comes to the front, and quits.

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

  // Validates that a path is a git repo
  async validateRepo(path: string): Promise<boolean>;

  // Copies untracked files (.env, etc.) from main checkout to worktree
  async copyUntrackedFiles(worktreeId: string, files: string[]): Promise<void>;
}
```

**Worktree location strategy:**

Worktrees are created inside `<repoPath>/.grove-wt/<short-id>/` where `short-id` is the first 8 characters of a UUID. The short directory name (`.grove-wt` instead of `.grove-worktrees`) and truncated IDs help avoid Windows' 260-character PATH_MAX limit, which is a real concern when combined with deep `node_modules` paths. The `.grove-wt` directory should be added to `.gitignore` (the app can do this automatically).

Alternative considered: `%APPDATA%/grove-bench/worktrees/` -- rejected because worktrees perform better when they're on the same filesystem as the repo, and it's easier to reason about where they are.

Alternative considered: Full UUIDs as directory names -- rejected because a path like `C:\Users\username\Documents\Projects\my-app\.grove-worktrees\550e8400-e29b-41d4-a716-446655440000\node_modules\@scope\package\dist\index.js` easily exceeds 260 characters. 8-char IDs give us 16^8 (4 billion) unique values, more than enough for any number of concurrent sessions.

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

#### PreviewManager (Preview tab)

`src/main/preview.ts` gives each conversation a browser with two pages that share one in-memory storage partition (`grove-preview-<sessionId>`, cleared when the conversation closes):

- **Your page** is a `WebContentsView` added to the Grove window. The renderer's `PreviewPanel` checks its content box every frame and reports changes (`preview:setViewport`); main places the view there (scaled by the Grove page's zoom factor, since CSS pixels and window pixels differ when the UI is zoomed), or hides it (`null`) when the tab, conversation or page mode changes. When Grove's UI reloads, main hides every page (the reloaded renderer doesn't know where they were) and the renderer catches up with `preview:getStates`. Native views draw above the HTML, so the panel samples a grid of points with `elementFromPoint`; when anything else is on top (a dropdown, dialog, the finder) it asks for a snapshot (`preview:snapshot`), shows it as an `<img>`, then hides the view until the overlay goes.
- **The agent's page** is a hidden `BrowserWindow` with `offscreen: true`, created on the agent's first browser tool call. A hidden or never-shown `WebContentsView` stops painting: `capturePage()` fails with "Current display surface not available for capture", ignores resizes and loses its surface on cross-site navigation. Offscreen rendering keeps painting (10 fps), so screenshots, clicks and typing work whatever tab the user is on. The renderer shows it read-only by polling `preview:agentFrame`, which only returns a frame when a paint happened since the last one.

The agent's tools are an in-process SDK MCP server (`src/main/adapters/preview-mcp-server.ts`, server `grove-preview`) over the adapter-neutral `PreviewOperations`: `preview_open`, `preview_screenshot`, `preview_read`, `preview_logs`, `preview_click`, `preview_type`. The first four run without a prompt for every agent, as the memory tools do (`isAutoAllowedGroveTool`, applied by the shared tool policy, `src/main/tool-policy.ts`), but only from a Grove server the agent was given in that thread: with the Preview tools off, a call named for `grove-preview` comes from some other server that took the name, and asks; click and type go through the normal permission prompt. Over ACP, Grove's tools are recognised only by names that include the server (`grove-memory_memory_read`, `memory_list (grove-memory MCP Server)`): Gemini CLI titles a call with arguments `memory_read(path: …)`, which another server's tool could share, so those still ask. A conversation's calls run one at a time in call order (the agent may send an open and a screenshot together), and each fails after 45 seconds so a stuck page can't stall the turn. Clicks and typing are real input events sent over the DevTools protocol (`webContents.debugger`, attached for the page's lifetime). The same connection answers `alert`/`confirm` dialogs, which would otherwise block the hidden page and every later call: OK by default, Cancel when the action passes `dialogs: 'dismiss'`, and the dialog's text goes in the log so the action reports it. The scripts that find, scroll to and focus the element (`src/main/preview-scripts.ts`) take the agent's selector or text as JSON, never as code, and scroll with `behavior: 'instant'` so pages with `scroll-behavior: smooth` report the final position. `settings.previewAgentTools` turns the server off for agents started afterwards.

Rules (`src/main/preview-policy.ts`, `src/main/preview.ts`):

- Your page opens any http(s) URL; the agent's page only local ones (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`). Both open `about:blank` and `file://` URLs inside the conversation's worktree; the agent's page only `.html`/`.htm` ones. Top-level navigations are checked on load, `will-navigate` and `will-redirect`; pop-ups load in the same page. A load that ends in `ERR_ABORTED` because the page redirected itself counts as loaded once the redirect finishes
- Every `file://` request, frames and scripts included, goes through `webRequest.onBeforeRequest`: it must be inside the worktree, and on the agent's page it must be a web file type (HTML, CSS, JS, images, fonts, media). Otherwise an HTML file could iframe `~/.aws/credentials` or a `.env` into a screenshot, getting round the user's read rules
- Both pages run with `sandbox`, `contextIsolation`, no Node and no preload. Permission requests are denied except `clipboard-sanitized-write`; device access is denied; downloads from the agent's page are cancelled
- Certificate errors are accepted for local hosts only, for dev servers with self-signed certificates
- Console messages, uncaught errors, failed loads, blocked navigations and files, dialogs, and 4xx/5xx or failed requests from the agent's page go to a 300-entry log (`src/main/preview-log.ts`) that `preview_logs` reads

Keys pressed in your page are handled in `before-input-event` (`src/main/preview-keys.ts`): browser keys run on the page and Grove's window shortcuts (listed once in `src/shared/grove-shortcuts.ts`: `Alt+1..5`, `Alt+M/T/E`, `Ctrl+B`, `Ctrl+N`, `Ctrl+Shift+T`) and `Ctrl+L` are sent back to the renderer (`preview:key`), which replays them as a window `keydown`. The pages close on `session:close`, `session:destroy` and when the Grove window closes; the agent's page also closes on `session:sleep`, since nothing drives it while the agent is asleep (the agent's pages are windows, so leaving them open would stop `window-all-closed` from quitting the app). Events a closing page still fires are ignored.

#### Images and files the agent makes

The thread shows what the agent makes, not just what it says:

- **Images a tool returns** (an MCP screenshot, Grove's `preview_screenshot`, `Read` on a .png) are saved to the thread's attachments folder (`src/main/attachments.ts`) and shown under the tool call, in every view: Focus shows the images alone. A subagent's show under its line in the thread too.
- **Files made in a turn**: while a turn runs, `src/main/turn-files.ts` watches the worktree (`fs.watch`, recursive) and notes changed paths of kinds worth looking at (images, PDFs, web pages, video, audio, spreadsheets, Office documents). At the end of the turn, files still there and written since it began are sent as a `files_made` event just before the result. A turn the user interrupts still lists its files; a stop (which a rewind uses, about to put files back), a sleep or a close drops the watch, all through one `endTurnFiles`, so a watch never carries into the next turn. Dependency, cache and compiled-output folders (`node_modules`, `dist`, `target`, `coverage` and the like) are skipped, but not `out` or `build`, where scripts save reports too. A web page counts only when the turn created it and didn't `Edit` it, and the list stops at 24 files. Up to 12 PNG/JPEG/GIF/WebP images (5 MB each) are copied to the attachments folder, named by a hash taken off the main thread, so older turns keep showing the image as it was. Files outside the worktree (a temp folder) aren't seen.
- **Images and links in a reply** that name a worktree file (`![home](shots/home.png)`, `[report](out/report.html)`): images load over `grove-attachment://worktree/<id>/<path>`, and links to the same kinds of file the turn list shows open it. Relative and absolute paths and `file://` URLs all work: the renderer keeps a local link's path in `data-local-href`, since DOMPurify drops an absolute one from `href`. A trailing `?query` is ignored and a `#anchor` carries over to the Preview tab. Links to other files (source code) do nothing, so a link the agent wrote can't open a script.

`src/main/worktree-files.ts` checks every such path: it must resolve, symlinks followed, inside the worktree, and only image types are served. Opening one from the thread sends a web page to the Preview tab, opens PDFs, media, spreadsheets, Office files and raster images in their default app, and only shows anything else (scripts, SVGs, macro files) in its folder.

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
- Bits UI (component library)
- Tailwind CSS v4 (utility-first styling)

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

When creating a worktree, the app generates a `.claude/settings.local.json` file with Grove's commit attribution settings and the project's `.mcp.json` approvals. It has no deny rules.

Earlier versions also denied `Read(../../**)` and `Edit(../../**)`, meant to keep Claude's file tools out of other worktrees and the main checkout. Neither rule did that: in tests with the agent SDK 0.3.281, Read, Grep and Write still reached the main checkout. Worse, Claude Code read `Read(../../**)` as covering the worktree itself (it sits two levels below the `worktrees` folder), so Grep and Glob searches there found no files. Before each start in a worktree, Grove removes those two rules from its settings file and keeps the rest.

Rules that would work need absolute paths (`Edit(//c/path/to/repo/**)`). Grove doesn't write them: in the modes that ask, Layer 3 already asks before edits outside the worktree, and a deny rule would refuse even edits the user wants to approve.

**Layer 3: Claude Code's interactive permission model**

Claude Code already prompts the user before performing file operations and shell commands. This acts as a human-in-the-loop check.

**Honesty note:** This is soft scoping, not a hard sandbox. A determined agent (or a prompt injection) could theoretically bypass these restrictions via raw shell commands. For the target use case (your own team running trusted agents on your own code), this is sufficient. For stronger isolation, see Docker-based sandboxing in v2 considerations.

### 5.3 What This Sandboxing Actually Protects Against

To be clear: this is an **ergonomic safety net**, not a security boundary. The goal is preventing accidental cross-contamination between parallel agents, not defending against malicious actors.

What it prevents:
- Agent A accidentally editing files that Agent B is working on
- Agents stepping on each other's branches or working trees
- In the modes that ask (Layer 3), edits to the main checkout or anywhere else outside the worktree without your approval. In auto mode Claude Code's classifier decides instead, and bypass mode doesn't ask

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
    → Generate .claude/settings.local.json (attribution, .mcp.json approvals)
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
  → TerminalManager.killAll()
  → AgentSessionManager.closeAll()
    → Same as closing each conversation: kill the agent process tree, deny
      pending permissions, flush the event log
  → App exits

Worktrees, branches and checkpoint refs are kept: conversations reopen on the
next launch. Only an explicit delete removes a worktree (Section 7.2).
```

## 8. Technical Considerations

### 8.1 node-pty on Windows

`node-pty` uses Windows ConPTY (available since Windows 10 1809). Key points:

- **Native module**: node-pty is a native Node addon. Version 1.1.0 ships Node-API prebuilds, which load in any Electron version, so it is not rebuilt (`npmRebuild: false` in `electron-builder.yml`).
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

git and gh run from the **process host** (`process-host.ts`), an Electron utility process, not from the main process. Starting a process is synchronous: on Windows, execa's PATH search (cross-spawn stats every PATH folder for every PATHEXT extension) and CreateProcess together held the main process for tens of ms per call, and sometimes seconds, freezing the window. `runProcess()` takes execa's arguments and sends them to the host; before the host is started (before the app is ready), after it has failed three times in a row, and once it has stopped at quit, it runs execa in the main process as before. A command asked for while the host starts, or restarts after a crash, waits for it and is sent once it is up, in order: at launch the app restores every project and thread, dozens of git and gh calls in its first seconds, which used to start in the main process. It waits 5 s at most (`HOST_WAIT_MS`: a utility process normally starts in well under a second, and a restart takes a 2 s pause plus a start), or until that start fails, and then runs in the main process; its timeout counts from when it is sent. If the host dies, the commands it was running are stopped; read-only ones run again in the main process and the rest fail, since they may already have done their work. A caller can mark a command safe to run again (`idempotent`: taskkill, ps, the `where` lookups), and it runs again in the main process whenever the host fails it, even at quit, so a thread's processes are still killed.

The agents' programs start the same way, from a second utility process, the **agent host** (`spawnProcess()`, `process-host-spawn.ts`): Claude Code's claude binary, and every ACP agent. An ACP agent is usually an npm `.cmd` shim, which Node's `spawn` can't start on Windows, so its request sets `findCommand` and the host runs cross-spawn's parse first, as execa does: it finds the command on PATH with PATHEXT and runs a shim through cmd.exe with its arguments escaped. The freeze log measured every claude.exe launch from the main process at 1 s or more, and up to 21 s on a PC running an antivirus. `spawnProcess()` returns at once with a stand-in for the ChildProcess the agent SDK expects (stdin, stdout, exit code, kill); the host starts the process and streams its input and output both ways, decoded as UTF-8 so no character is split. A spawn asked for while the host is starting waits for it, since the open thread's agent starts within seconds of launch. Agents get their own host because the git host is restarted when a command goes unanswered, and a restart stops whatever the host started: when the agent host dies, its agents are stopped and reported as exited. The claude CLI's auth, mcp and plugin calls run there too (`runInAgentHost()`, `process-host-run.ts`), as spawned processes whose output is collected in the main process: a plugin install has no time limit and `mcp list` can hang, so in the git host one would be stopped by, or cause, a restart. Their time limit is kept in the main process and kills the whole tree (`killTree`), not just cmd.exe.

A command's deadline (its timeout plus a minute) only restarts the host when it fires on time. Windows counts system sleep in timers, so a deadline set before sleep fires the moment the computer wakes, before the host has had a chance to answer; on 9 Oct that restarted the host. A deadline that fires 30 s or more late gives the command its full time again instead (`LATE_DEADLINE_MS`). A host killed for not answering takes no new commands until it has restarted (they run in the main process meanwhile), and the command that found it out fails as timed out, or runs again in the main process if it is idempotent.

```typescript
import { runProcess } from './process-host.js';

async function git(args: string[], cwd: string) {
  const result = await runProcess('git', args, { cwd });
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

Checks run in the background at startup and never block the app. The last
result is cached in `app-state.json` and shown at the next launch while a fresh
check runs. Git gates only git-backed features; agent credentials are asked for
when the user starts a conversation.

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

If git is not found or below 2.17, show a dismissible notice under the title bar. Projects, worktrees and the Changes tab need it; the rest of the app loads. Git 2.5 introduced worktrees, but 2.17+ has important Windows fixes and `git worktree move` support.

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

Conversations don't need the installed CLI: the Agent SDK runs its own bundled Claude Code binary unless `pathToClaudeCodeExecutable` is set ([quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)). The CLI is used to read an existing sign-in (`claude auth status --json`) and for MCP and plugin configuration. Both CLI calls have a time limit so a hung CLI can't stall the check.

**Credentials.** The agent is ready when any of these is true:

- An API key is saved in the app. It is encrypted with Electron `safeStorage` in `<userData>/credentials.json` (`src/main/credentials.ts`), never sent to the renderer, and passed to the agent as `ANTHROPIC_API_KEY`. While saved it wins over a CLI sign-in, which matches how Claude Code treats that variable ([env vars](https://code.claude.com/docs/en/env-vars)).
- `ANTHROPIC_API_KEY` or a provider switch (`CLAUDE_CODE_USE_BEDROCK`, `_VERTEX`, `_FOUNDRY`, `_ANTHROPIC_AWS`) is set in the environment.
- `claude auth status` reports a sign-in.
- `claude auth status` can't be read: it didn't start, timed out or printed no sign-in. That says nothing about the sign-in, so the agent counts as ready but unchecked (`authUnchecked`) and the reason goes to the log. A missing sign-in then comes back as an auth error when the thread starts. Only `"loggedIn": false` counts as signed out; the CLI reports it with exit code 1 ([CLI reference](https://code.claude.com/docs/en/cli-reference)).

If none is, the New Conversation dialog shows an API key field and a Re-check button instead of the form. The key can be changed or removed later in Settings > Agent.

A pasted key is checked before it is saved (`AgentAdapter.verifyApiKey`; for Claude, one `GET /v1/models` call, [List Models](https://platform.claude.com/docs/en/api/models/list)): a 401 turns it away next to the field, and when the provider can't be reached it is saved and marked unchecked. Skipped when `ANTHROPIC_BASE_URL` points conversations elsewhere. A key can still fail later (revoked, typo saved offline): the SDK flags the reply `authentication_failed`, the adapter turns it into an `error` event with `auth` and `keyRejected` set and its own sign-in help in place of the CLI's text, the thread links to Settings > Agents, and main marks the saved key refused (`markApiKeyRejected`). A refused key counts as no credentials (`agentReady`), so new conversations ask again until it is replaced or removed.

**Several agents.** Every check above runs for each registered adapter, and `PrerequisiteStatus.agents` holds the result per adapter id. Saved keys, default models (`settings.defaultModels`) and the Settings > Agent groups are per adapter too. The New Conversation dialog shows an Agent picker when more than one adapter is registered and asks for the picked agent's credentials; the status bar lists the models of the conversation's own agent. **Default agent** (Settings > Agents, `settings.defaultAgent`) picks the agent new threads start on; left at "Same as the open thread", a new thread takes the open thread's agent, else the built-in default, Claude Code (`AgentSummary.isDefault`, `adapterRegistry.getBuiltInDefault`). A pick that isn't offered for new threads (an alpha agent turned off, a removed account) is ignored, by the same rule in main (`pickedDefaultAgent`) and the renderer (`agentsStore.pickedDefaultId`). Calls that name no agent use the default; one that names an agent that isn't registered is refused rather than sent to the default (`resolveAdapter`, skills, worktree settings). The Settings MCP tab picks its agent; the Plugins tab configures the built-in agent and is hidden when it doesn't support plugins.

**Several Claude accounts.** Claude Code keeps an account's sign-in, history, settings, MCP servers and plugins in one folder, picked with `CLAUDE_CONFIG_DIR` ([Log in with multiple accounts](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts)). Each account in `settings.claudeAccounts` registers as its own Claude adapter (`claude-account-<id>`, `src/main/adapters/claude-accounts.ts`), so per-adapter keys, default models, model lists, background tasks and the manifest's `adapterType` need nothing new. `adapterType` also resumes a thread on the account it started on, which matters because its transcript is in that account's folder. The default account stays `claude-code` with `~/.claude`.

Accounts are added from the Claude agent's **Add account** button (its adapter declares `capabilities.accounts`). The dialog asks main to check the name and folder as they are typed (`newClaudeAccount`): the id comes from the name and is saved with the entry, so the agent and its default folder (`~/.claude-<id>`) stay the same if the name changes; a typed folder loses Explorer's quotes, expands `%NAME%` and `~`, and is saved as an absolute path; a name whose id is taken, the home folder, the default account's folder and another account's folder are turned away. Main registers the adapter at once and the renderer saves the entry like any other setting. Removing an account only takes it out of the settings: the agent list marks it `account.removed`, so it isn't offered for new threads or shown in Settings, while threads already on it keep it until a restart. After that its threads can't start, and their background tasks are treated like those of any agent that is gone (see Background tasks).

An account agent:

- runs Claude Code, `claude auth status`, `claude mcp` and `claude plugin` with `CLAUDE_CONFIG_DIR` set to its folder, and keeps user skills in `<folder>/skills`.
- drops the credentials, provider switches and `ANTHROPIC_BASE_URL` inherited from Grove's environment (`INHERITED_SIGN_IN_ENV`), which Claude Code would otherwise use over the folder's sign-in ([authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)). Its own saved key still wins, as for the default account, and is checked with Anthropic directly.
- signs in with Claude Code's own `claude auth login`, which the user runs in PowerShell with the folder set (the command clears the variable afterwards, and doubles every character PowerShell reads as a single quote, including the typographic ones), so the authentication rules below still hold: Grove never reads the sign-in.
- has no provider title for its threads: the SDK's `getSessionInfo` reads transcripts in Grove's own process, from Grove's `CLAUDE_CONFIG_DIR`, and takes no folder.

**Background tasks.** Memory notes, memory compaction, commit messages and skill suggestions call `adapter.generateText()` (`src/main/background-tasks.ts`). Each runs on the agent of the conversation it belongs to, so a conversation's content only goes to the provider chosen for it. The manifest records every conversation's agent (`adapterType`), which also lets a restart resume it on the same agent. When that agent is gone (a custom agent taken out of Settings, a removed Claude account, after a restart), nothing is sent to another provider unasked: a task the user starts (a commit message, a new goal) asks which agent to use instead (`backgroundAgentStore`, `BackgroundAgentDialog`) and keeps the answer for that thread until restart, and automatic ones (memory notes) are skipped (`backgroundAgentFor` returns null, `recordedAgent` throws without a `substitute`). Project-level tasks use the project's most recently used agent that is still there, else the default agent: manual compaction any agent, skill suggestions only an agent with skills, and suggestions only read that agent's conversations. The model is the user's pick in `settings.backgroundModels`, else the adapter's own `backgroundModel` (Claude: the SDK's current Haiku), else the agent's default.

**Model lists.** The Claude adapter reads the SDK's list (`Query.supportedModels()`) when a conversation starts, once per run, and caches it in `app-state.json` (`modelCatalogs`) for the next launch; `FALLBACK_MODELS` covers the first launch. The SDK lists aliases (`opus`, `sonnet`, `haiku`) with the model each resolves to; Grove keeps the resolved id so saved choices keep matching, skips the account's `default` row (Grove has its own Default), and lists Opus first so new conversations still start on Opus. The SDK's effort levels, adaptive thinking, fast mode and auto mode drive the session controls; each model's default effort and whether thinking can be switched off still come from the adapter's table, since the SDK doesn't report them. When the list changes, the main process sends `agent:modelsChanged` and the status bar and Settings refetch.

**Authentication rules.** Anthropic's terms decide which sign-in paths the app may offer ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)):

- **Allowed: the user's own Claude subscription through Claude Code.** The terms don't prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". The user signs in with `claude auth login`, which is Anthropic's own flow. Grove only runs `claude auth status` to see whether they are signed in. It never reads, stores or forwards the sign-in token; the agent process reads it itself.
- **Allowed: the user's own API key or cloud provider credentials,** billed to the user under their own agreement.
- **Not allowed: a Claude login inside Grove.** Third-party developers may not offer Claude.ai login in their own apps, collect or store Claude.ai credentials or session tokens, or route requests through Free, Pro or Max credentials on their users' behalf. Don't add a "Sign in with Claude" button or read the CLI's stored tokens without Anthropic's approval.
- **Keep the binary as published.** Don't modify the bundled Claude Code binary or remove or disable any of its sign-in methods.
- **Don't pay for or resell usage.** Each user brings their own subscription, key or cloud credentials.
- **Commercial Terms.** Running Claude Code inside a product requires agreeing to Anthropic's Commercial Terms of Service, which also govern the Agent SDK.
- **Naming.** Plain-text statements that Grove runs Claude Code are fine. The agent is labelled "Claude Agent" in the UI, as the SDK branding guidelines suggest for menus. Don't use "Claude Code" or Anthropic's names or logos as part of Grove's own product, feature or company name.

For anything these rules don't settle, Anthropic asks developers to contact its sales team.

## 9. Project Structure

> **Note:** This is a simplified overview. See `CLAUDE.md` for the current detailed structure.

```
grove-bench/
├── package.json
├── tsconfig.json
├── svelte.config.mjs            # Svelte config
├── forge.config.mjs             # Electron Forge config
├── vite.main.config.mjs         # Vite config for main process
├── vite.renderer.config.mjs     # Vite config for renderer
├── vite.preload.config.mjs      # Vite config for preload
├── vitest.config.mts            # Test config
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry point
│   │   ├── ipc.ts               # IPC handler registration
│   │   ├── git.ts               # Typed git CLI wrapper (execa)
│   │   ├── worktree-manager.ts
│   │   ├── agent-session.ts     # Session lifecycle
│   │   ├── agent-utils.ts       # Agent helper utilities
│   │   ├── prerequisites.ts     # Git/Claude detection & version checks
│   │   ├── terminal.ts          # node-pty management
│   │   ├── preload.ts           # contextBridge definitions
│   │   ├── app-state.ts         # Persistent app state
│   │   ├── memory.ts            # Project memory system
│   │   ├── memory-autosave.ts
│   │   ├── logger.ts            # File-based logging
│   │   └── adapters/            # Agent adapter pattern
│   │       ├── types.ts         # Adapter interfaces
│   │       ├── registry.ts      # Adapter registry
│   │       └── claude-code.ts   # Claude Code adapter
│   ├── renderer/                # Svelte UI
│   │   ├── main.ts              # Svelte app entry
│   │   ├── App.svelte
│   │   ├── components/          # ~34 Svelte components
│   │   ├── lib/                 # Utilities
│   │   ├── stores/              # Svelte stores (sessions, messages, settings, etc.)
│   │   └── styles/              # CSS
│   └── shared/
│       └── types.ts             # Shared types between main/renderer
├── docs/                        # Design docs, user stories
└── landing/                     # GitHub Pages landing site
```

## 10. Dependencies

> **Note:** See `package.json` for the authoritative dependency list. Key production dependencies:

| Package | Purpose |
|---------|---------|
| electron | App shell (v33.x) |
| node-pty | PTY for terminals (native module) |
| @xterm/xterm | Terminal emulator UI (v6) |
| @xterm/addon-fit | Auto-resize terminal |
| @xterm/addon-web-links | Clickable URLs in terminal |
| execa | Git CLI wrapper |
| @anthropic-ai/claude-agent-sdk | Claude Code agent integration |
| bits-ui | UI component library |
| marked + highlight.js + dompurify | Markdown rendering |
| fuse.js | Fuzzy search |
| zod | Schema validation |
| diff | Diff computation |
| tailwind-merge + tailwind-variants | Tailwind utility helpers |

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
| High memory usage with many xterm instances | Low | Low | xterm.js is lightweight. node-pty processes are the main cost |
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
| Prerequisite failure | Git not found or too old, no agent credentials | Git: a notice with Download Git and Re-check on the first screen, in a new conversation and at the top of the Changes tab. Credentials: API key step in the New Conversation dialog. Neither blocks the app. |
| Worktree creation failure | Branch already exists, disk full, permission denied | Error toast + details. Session creation aborted, no terminal opens. |
| PTY crash | Claude Code exits unexpectedly, shell crashes | Terminal shows exit message in red. Agent status changes to "stopped". User can destroy and recreate. |
| Worktree cleanup failure | File locked by another process | Warning toast. Retry button. Flag for cleanup on next startup. |
| IPC error | Message serialization failure | Log to console. Should be rare, indicates a bug. |

### 13.2 UI Elements

- **Status bar** at the bottom of each terminal pane showing agent status (running/stopped/error)
- **Toast notifications** for non-blocking errors (worktree cleanup issues, background warnings)
- **Modal dialogs** for blocking errors (can't create session)
- **Terminal inline messages** for PTY-level events (process exited, connection lost)

### 13.3 Logging

All errors log to a file at `%APPDATA%/grove-bench/logs/`. Useful for debugging when things go wrong. Log rotation: keep last 5 files, max 10MB each.

## 14. v2 Considerations (Out of Scope, Documented for Later)

- Support for Codex, Gemini CLI, Aider, and other agents (adapter pattern is in place)
- Docker-based sandboxing
- Cross-platform support (macOS, Linux)
- Shared CLAUDE.md / agent instructions per worktree
- Agent-to-agent communication (one agent's output feeds another)
- Git operations UI (merge, rebase, cherry-pick between agent branches)

> **Already implemented since v0.3:** Built-in diff viewer, session persistence, settings UI, slash commands, skills, MCP server connections, drag-and-drop image attachments, auto-update via electron-updater (see `docs/electron-install.md`).
