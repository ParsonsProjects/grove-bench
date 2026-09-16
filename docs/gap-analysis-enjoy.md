# Gap Analysis: Enjoy vs Grove Bench

*Researched 2026-09-16 against [enjoy.dev](https://enjoy.dev/), its interactive demo (`enjoy.dev/demo`), and the
[atmoio/enjoy-releases](https://github.com/atmoio/enjoy-releases/releases) page (v0.1.26, released the same day).
Enjoy is closed-source and has no public docs or changelog, so everything below comes from the marketing page and the
view-only demo workspace. Demo data is illustrative; where a capability could not be confirmed it is marked as such.*

## 1. Positioning

| | Enjoy | Grove Bench |
|---|---|---|
| Tagline | "the best way to build anything with AI" / "a desktop workspace for coding agents" | Multi-agent git worktree orchestrator for Claude Code |
| Audience | "The team of one." Explicitly non-terminal users: "if you've never used a terminal you're not going to start now." Founders, solo builders, product people. | Developers already running Claude Code who want parallel, isolated sessions |
| Mental model | **Projects → Conversations / Docs / Recipes / Terminals** (a project-management workspace that happens to drive agents) | **Repos → Sessions (worktrees) → Activity / Changes / Checkpoints / Terminal** (a git-centric engineering bench) |
| Agents | Claude Code, Codex, Grok Build, via the user's existing subscriptions | Claude Code only (adapter registry exists, one adapter registered) |
| Platforms | macOS 13+ (universal, signed + notarized), Windows x64 (unsigned) | Windows only (unsigned NSIS) |
| Price / license | Free (1 project, desktop only); Unlimited $14.99/mo (unlimited projects, phone/browser access, E2E-encrypted device messaging) | Free, MIT |
| Storage | `.enjoy/` folder in the project: `threads/<id>/messages.md`, `recipes/*.md`, docs. "Plain files. Yours to keep." Every item has an "Open in default app" link. | `%APPDATA%` JSON for sessions/settings; per-repo markdown memory; worktrees in `.grove-wt/` |
| Maturity | v0.1.x, ~10 releases in one week (Sept 9-16), Windows "experimental" | 0.0.0-alpha.2, 130 commits, 70 PRs |

The products overlap on "run many agent conversations in parallel without terminal tabs" and diverge on almost everything
else. Enjoy is a **project workspace** first; Grove Bench is a **git workbench** first. Several gaps below are
therefore audience choices rather than missing engineering, and are labelled that way.

## 2. What Enjoy has that Grove Bench lacks

Priority reflects how much the gap matters to Grove Bench's *own* audience (developers), not to Enjoy's.

### P1: directly relevant to Grove Bench's audience

| Gap | What Enjoy does (verified in demo) | Grove Bench today | Notes |
|---|---|---|---|
| **Multiple agent backends** | Agent settings dialog offers Claude Code / Codex / Grok Build side by side. Each has its own model list (Opus 4.6, Sonnet 4.6, Haiku 4.5 for Claude; "Astra Medium" shown for Codex) and effort levels. | Adapter pattern in `src/main/adapters/` with only `claude-code.ts` registered. Already TODO P1. | The single largest gap. Codex CLI ships an app-server/JSON protocol and Grok Build is terminal-native, so both fit the adapter interface. |
| **Switch agent mid-conversation** | "change the brain. keep the thread." Choose an agent to plan, another to build, without restarting. Demo has an "Agent handoff" thread. | Model can be switched per session; agent cannot. | Requires a provider-neutral transcript that can be replayed as context into a different backend. Enjoy's plain-markdown thread files make this cheap for them. |
| **Attention triage across projects** | Conversation list has filter chips **All / Needs you / Working / Unread** with counts. Sidebar shows per-project "2 agents working", "3 conversations need attention". Conversations carry **Completed** / **Needs you** / **Working** state, unread badges, a "Mark as completed" action, and a "Show completed" toggle. | Status dots, amber pulse for pending permission, attention flash on sidebar + status bar, Active/Inactive lists, session finder (Ctrl+R). No unread tracking, no "completed" state, no filter chips, no per-repo counts. | Most of the signals exist in `sessions.svelte.ts`; this is a presentation and state-model gap. Cheap, high-value. |
| **Usage "runway"** | "See remaining usage and reset times in the agent picker." | `rateLimit.svelte.ts` stores `utilization` and `resetsAt` but only surfaces a yellow/red indicator once a limit is near or hit. Context-window meter exists. TODO P2 has a cost dashboard. | Always-on quota display in the model picker is a small change on top of existing data. |
| **Human-readable transcripts on disk** | Every thread is `.enjoy/threads/<id>/messages.md` with an "Open in default app" button. | Event log persisted in app-state JSON; memory notes are markdown. TODO P2 "Session export (Markdown / JSON)". | Also the enabler for agent switching and for grep-ability. |
| **Effort levels and speed** | Effort: Low / Medium / High / xHigh / Max / Ultracode. Speed: Standard / Fast. | Thinking: Off / Low / Med / High / Adaptive. No fast-mode toggle. | Small. Map xHigh/Max to SDK effort where supported; add fast mode. |
| **Guided install and sign-in** | Windows installer "includes guided installation plus sign-in for Claude Code and Codex". | Prerequisite check reports missing git / claude / gh and shows install instructions, but does not install or run the login flow. | Matters for first-run conversion even for developers. |

### P2: useful, partly covered, or a product decision

| Gap | What Enjoy does | Grove Bench today | Notes |
|---|---|---|---|
| **Recipes** (saved, schedulable instructions) | Library of prompts organised into **Collections** (All / Scheduled / Yours / custom). Each recipe: description, "Any agent" or a specific agent, **On demand** or scheduled, **Play** runs it in a new conversation, stored as `.enjoy/recipes/*.md`. Landing: "Run them on demand or on a schedule." | Skills (project/user scope, enable/disable in status bar, AI-suggested skills), slash commands, per-repo memory. No scheduling, no "run this in a fresh session" button, no collections. | Skills are the same primitive. Missing pieces are scheduling (cron-style, main-process timer that spawns a session) and one-click run. |
| **Managed background terminals** | **Terminals** section: named, searchable list of long-running processes with Running/Stopped state, **Stop** button, "1 running in the background", output follows the log, **Wrap output lines**, **Download output**. Conversations link to the terminal they started. | One PTY per session (Terminal tab, Alt+4). "Localhost run / dev-server management" was implemented then deliberately removed in #53. | Enjoy's version is a process list, not a dev-server feature. Worth revisiting as "named background commands with captured output" now that PR auto-fix and CI watching exist. |
| **Project docs with selection-to-task** | **Docs** section: rich-text editor (Text style, bold/italic/strike, bullet/numbered/to-do lists, quote, code block, links, undo/redo), **Rich text / Raw** toggle, pin, attached images, tables, search. Prompt bar has "@ Docs & recipes". Landing: "Select a passage and turn it into a task for your agent." | Memory panel (four folders, markdown edit, auto-compaction, budget meter), Markdown Focus panel (read-only), `@` file picker, bookmarks. | Grove Bench's memory is agent-facing; Enjoy's docs are user-facing planning notes. The selection-to-prompt piece is small and could reuse `SelectionMenu.svelte`. WYSIWYG editing is a large investment with low value for developers. |
| **Per-project agent instructions** | Project settings: name, folder, **Instructions** ("Custom instructions for your agent, like 'commit changes after every change.'"). | Global "System Prompt Append" only; per-repo behaviour lives in `CLAUDE.md` and memory `conventions/`. TODO lists "Shared CLAUDE.md / agent instructions per worktree". | Small settings addition. |
| **Question UI parity check** | "Review pending question" block with radio options, "Or write your own answer", **Confirm**; "Older messages / Latest messages" jump. | `QuestionBlock.svelte` exists. | Parity; listed to confirm it was checked. |
| **Agent activity hidden by default** | Chat shows only user/assistant text; **Show agent activity** toggles tool calls in. | Activity tab shows everything; **Focus** view mode (#67) and Summary mode reduce noise. | Parity in capability, opposite default. Fine for a developer audience. |

### P3: strategic or out of current scope

| Gap | What Enjoy does | Grove Bench today | Notes |
|---|---|---|---|
| **Phone and browser access** | Paid tier: "work from your phone or browser", desktop must stay awake and running Enjoy as the host; "end-to-end encrypted device messages"; `app.enjoy.dev` web client. | None. TODO P3 "Web mode". | Large: needs a relay or direct pairing, auth, and a second UI. High value for the "step away, stay in command" case that PR-watching notifications only partly cover. |
| **macOS** | Universal DMG, signed and notarized. | Windows-only by design (DESIGN.md non-goal). TODO P3. | node-pty, git, and Electron all work on macOS; the Windows-specific code is mostly file-locking retries and shell detection. |
| **Multiple projects as first-class workspaces** | Each project has its own Conversations / Docs / Recipes / Terminals / settings; sidebar shows per-project activity counts; "Remote workspace" label suggests projects can live on another machine. | Multi-repo sidebar with colours, collapse, sort. Sessions are the unit, not projects. | Mostly covered by the triage item in P1. |
| **Hosted account, billing, Slack community, brand kit** | Free/paid plans, sign-in, community Slack. | Open source, PostHog opt-in analytics, no accounts. | Not a product gap for an MIT tool; noted for completeness. |

## 3. What Grove Bench has that Enjoy does not show

Nothing on Enjoy's site or in the demo indicates any of the following. The landing page mentions "Git branches" once
and nothing about worktrees, diffs, PRs, MCP, or permissions rules. Treat these as Grove Bench's moat with developers.

- **Git worktree isolation per session**, auto `.gitignore`, short IDs for PATH_MAX, orphan detection and cleanup, locked-worktree deferral, "Existing worktree" and "Direct" modes.
- **Changes tab**: staged / unstaged / untracked, unified and side-by-side diffs, per-file edit history, per-file revert, send prompt from the diff, selection menu.
- **Checkpoints and rewind**: per-turn git snapshots, "This turn / Since here / All turns" diffs with line stats, Rewind All vs Conversation Only, `/rewind`.
- **Full PR workflow**: Commit & Push, Create PR dialog (auto-populated), `gh pr create`, PR state / checks / review polling for all sessions, one-click "fix CI" and "address review" turns, opt-in auto-fix mode with attempt caps, alert chips, OS notifications for new failures and comments.
- **Permission control**: default / plan / acceptEdits / auto / bypass modes, glob allow/deny tool rules, sandbox-backed Auto mode that auto-approves read-only calls, per-worktree deny rules, Allow / Always / Deny with diff preview.
- **MCP management**: list servers with live health, add stdio/HTTP/SSE servers at user/project/local scope, reconnect/disconnect per server from the status bar, browser sign-in for servers that need auth. **Plugins** marketplace tab. **Skills** management with AI suggestions.
- **Project memory** with four folders, auto-save, auto-compaction (dedupe, contradiction resolution, session pruning), snapshots, undo, budget meter.
- **Observability**: context-window meter with cached segment, 1M-context request for capable models, background-task (subagent) indicators, rate-limit indicator, thinking indicator, file logging.
- **Worktree ergonomics**: auto-copy `.env` and friends, optional auto `npm install` with shared cache, idle auto-stop, power-suspend flush and resume health check, "Clean up old sessions" with uncommitted-change protection.
- **Search**: cross-session full-history event search, in-thread search with highlighting, session finder, bookmarks.
- **Transparency**: open source, no account, no subscription, analytics opt-in.

## 4. Parity

Both products have: multiple concurrent conversations, model picker, effort/thinking control, permission-mode picker,
`@` file/doc references, image attachments, search, light/dark/system theme, keyboard shortcuts, some form of
"needs your input" state, a terminal, plain-markdown files on disk (memory in Grove Bench, everything in Enjoy),
and Windows builds that are currently unsigned.

## 5. Recommendations, in order

Priorities agreed 2026-09-16: multi-provider first (with provider-specific status bar controls rather than a forced
unification), then attention triage and usage runway, then Enjoy's grouping and recipes UX.

1. **Adapter-declared status bar controls, then a Codex adapter, then Grok Build.**
   The adapter interface is already neutral (capability flags plus `getModels()`), but the renderer is Claude-shaped:
   `ThinkingLevel` and `PermissionMode` are fixed enums in `src/shared/types.ts`, the stores cycle those fixed lists,
   and `StatusBar.svelte` hardcodes the labels and never reads the `listAdapters()` capabilities it could fetch.
   Codex's Low / Medium / High / xHigh / Max and Grok Build's modes do not fit five thinking slots and four
   permission modes. Proposed shape:
   - Replace option-bearing capability flags with **control descriptors** returned by the adapter per model:
     `{ id, label, options: [{ value, label }], default }` for `effort`, `speed`, `permissionMode`, and anything
     provider-specific. The status bar renders one badge per descriptor; Alt+M / Alt+T cycle the adapter's list.
   - Per-model, not per-adapter, because options such as fast mode or the 1M window exist only on some models.
   - Keep as plain flags what is present-or-absent: MCP control, skills, plugins, image attachments.
   - Keep unified what is not provider-related: session status, context meter (adapter reports the window),
     rate limit and usage runway (adapter reports normalized utilization and reset time), git and PR controls.
   - Knock-ons: default model and default thinking level become per-adapter settings; tool allow/deny rule syntax
     is Claude's and needs an adapter-owned parser or a neutral form; sessions already carry `agentType`, so the
     sidebar can show a provider badge with no schema change.
   - Decide up front whether mid-thread agent switching is in scope. It adds an agent picker to the status bar and
     constrains the transcript format in item 4.

   **Status (2026-09-16): control descriptors are implemented.** `AgentAdapter.getControls(model)` returns
   `ControlDescriptor[]` (`src/shared/types.ts`); the Claude adapter declares `permissionMode`, `thinking` (adaptive
   only on adaptive-capable models), and `speed` (Standard / Fast, Opus 4.8+ only). The session manager owns the
   values, validates them against the current model, passes them to `adapter.start()`, resets any option a new model
   does not offer, and emits `controls_sync` on query start, model switch, and control change. The status bar shows a single
   two-line **Agent settings** trigger (agent on top; model, context window, and every control value beneath) that
   opens an Enjoy-style column-per-setting popover (`SessionControlsPopover.svelte`) in Grove's popover style;
   Alt+M / Alt+T still cycle the well-known ids.
   Still open: per-adapter defaults in Settings (the Agent tab's default thinking level is still Claude's list), a
   neutral form for tool allow/deny rules, and the Codex adapter itself.
2. **Attention triage.** Add `unread` and `completed` to session state; add All / Needs you / Working / Unread filters and per-repo counts to the sidebar; add "Mark completed". Mostly reuses existing status signals.
3. **Always-visible usage runway** in the model picker, from the existing rate-limit store, plus the TODO cost dashboard.

   **Status (2026-09-16): done.** `AgentQueryHandle.getUsage()` returns a neutral `ProviderUsage` (windows with
   0–1 utilization and epoch reset times); the Claude adapter maps the SDK's experimental `/usage` control and probes
   for it so a rename degrades to "no usage". `usage.svelte.ts` keeps one snapshot per provider, refreshes on popover
   open and after each turn (throttled), and folds live `rate_limit` events into the matching window. The Agent
   settings popover shows a bar, percentage, and reset time per window under the agent name, with plan name, and an
   explanation for API-key sign-ins. The cost dashboard remains open.
4. **Markdown transcript per session** written to disk (`.grove-wt/<id>/thread.md` or under the repo's memory dir) with "Open in editor". Satisfies TODO "Session export" and enables agent switching.
5. **Grouping and recipes UX.** Project-style grouping in the sidebar (per-repo sections with activity counts, collapsible, matching Enjoy's Projects → Conversations layout), and Skills → Recipes: collections, one-click "Run in new session", and a main-process scheduler. Skills already have the storage and UI.
6. **Named background commands** with captured, downloadable output and Stop, decoupled from the session PTY. A narrower reimplementation of what #53 removed.
7. **Per-repo agent instructions** field in settings (writes to `CLAUDE.md` or a memory `conventions/` note).
8. **Guided install / sign-in** on the prerequisite screen (run the installer and `claude login` from the app).
9. Defer **docs WYSIWYG**, **mobile/browser remote**, and **macOS** unless the audience shifts toward Enjoy's. Remote access is the most valuable of the three given PR-watching already creates "step away" moments.

## 6. Verification notes

- Enjoy's demo is view-only sample data; conversation states, terminal output, and recipe schedules are illustrative ("No agents or terminals are running").
- Release notes on GitHub contain only version, platform, and signing information. No per-release feature lists exist.
- `enjoy.dev/docs` and `enjoy.dev/changelog` return 404. `app.enjoy.dev` renders a blank shell without sign-in.
- Worktree or branch-per-conversation behaviour could not be confirmed either way; the landing page lists "Git branches" under "all the little things" without detail.
- Grove Bench inventory comes from `docs/help/*.md`, `TODO.md`, `src/shared/types.ts`, and the git log through #70 (2026-09-16).
