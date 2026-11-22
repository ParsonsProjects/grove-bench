# Grove Bench — Gap Analysis

Feature gaps identified by comparing against [Toad](https://github.com/batrachianai/toad) and other agent tools, plus gaps found by auditing the codebase against DESIGN.md and docs/user-stories.md.

## Priority 1 — High Impact

### Multi-Agent Support
- [x] Adapter-declared session controls — `AgentAdapter.getControls(model)` returns per-model `ControlDescriptor`s (mode, thinking, speed, …); the session manager owns the values, validates them per model, passes them to `adapter.start()`, and emits `controls_sync`. The renderer no longer hardcodes thinking or permission-mode enums.
- [x] Agent settings popover — one two-line status-bar trigger (agent on top; model, mode, and any non-default control beneath) opening a column-per-setting popover for agent, model, and every declared control (`SessionControlsPopover.svelte`). Alt+M / Alt+T still cycle.
- [x] Multi-agent groundwork — per-agent prerequisite status (`PrerequisiteStatus.agents`), saved API keys and default models (`settings.defaultModels`, schema v5 migration); Agent picker in New Conversation; Settings > Agent grouped per agent; status bar model list follows the conversation's agent; Settings MCP / Plugins tabs hidden when the default agent lacks them
- [x] Per-agent background tasks — memory notes, compaction, commit messages and skill suggestions run on the conversation's own agent with its background model (`adapter.backgroundModel`, `settings.backgroundModels`, schema v6 migration from `memoryModel`); the manifest records each conversation's agent so restarts resume on it
- [ ] Codex adapter: implement `getControls`, `getModels`, `start`, `setControl`, and `getUsage` against the Codex app-server protocol and register it; attach a `toolView` (shared/tool-view.ts) to tool events so the thread, permission prompts and Read-safe mode understand Codex's tools. Until then Codex runs through the ACP adapter with `codex-acp` as a custom agent
- [ ] Grok Build adapter
- [x] Steer a running turn (alpha, Claude only): Alt+Enter, or **Send now** on a queued message, gives a message to the running turn, read once its current tool call finishes (`steerMessage` in `agent-session.ts`, `claude-steers.ts`, sent with `priority: 'next'` and a uuid). It waits 5 seconds first with **Take back**, as the SDK can't take back a message Claude Code has (no method for the CLI's `cancel_async_message`, checked in 0.3.281 and 0.3.330). The thread shows it only once read (`user_message` with `steer`, no checkpoint, no rewind); a result is held while one is unread. Stop with one unread ends the agent process, since a plain interrupt leaves it to run, and it goes back to the paused queue marked not read. Settings > The grove can make Enter steer. ACP agents queue only (ACP has no mid-turn input). Left to do: a run in the packaged Windows app with a real Claude sign-in, to confirm reads are seen live (`user_message_uuids` on a typed turn may only arrive with the result) and the held-result timing; longer Take back once the SDK can cancel a queued message
- [x] Queue: saved across restarts in localStorage (`queue-storage.ts`, back paused), Edit in place (Enter saves, Esc cancels, the draft comes back), up/down to reorder, click to show a whole message, **Merge** and **Clear queue** for two or more (Button `subtle` / `outline-destructive`), **Send** one now while idle, and an Undo toast for 5 seconds after Remove, Clear queue or Merge (`MessageQueue.svelte`, `messages.svelte.ts`)
- [ ] Handoff sized to the new agent: when switching agent mid-thread, size the transcript to the new model's context window instead of a fixed 32,000 characters with 2,000 per message (`agent-handoff.ts`), keep whole messages, and give the agent a tool to read the messages left out. Switching back to an agent the thread used before should resume that agent's own session and send only what happened since; today `switchAgent` clears `providerSessionId`, so it always starts a new one
- [ ] More built-in ACP presets (Kiro CLI, Antigravity, fx) with their launch arguments and sign-in steps, and an `env` field on `AcpAgentSetting` (`shared/types.ts`) so a custom agent can be given keys such as `KIRO_API_KEY`
- [ ] Text generation without a coding agent: an opt-in choice per task (titles, commit messages, PR text, memory notes) to use a plain model API instead (Anthropic, OpenAI, OpenRouter, or an OpenAI-compatible endpoint such as Ollama or LM Studio). Today every background task runs through the thread's agent (`background-tasks.ts`, `background-text.ts`). Keep the rule that a thread's content only goes to a provider the user picked
- [x] Open models through OpenCode (alpha, off until enabled in Settings > Agents): built-in ACP preset (`adapters/acp/opencode.ts`) that makes OpenCode ask before it acts and locks its local server; an OpenRouter key saved in Grove starts conversations on DeepSeek V4.1 Flash. Left to do (a Windows run with a real key, OpenCode's retried replies and subagents, to-do lists, cost) in `docs/open-model-harnesses-plan.md`
- [x] Per-adapter defaults in Settings — `adapterDefaults` (adapter id → control id → value) replaces `defaultThinkingLevel` (settings schema v2 migration); the Agent tab lists every registered adapter's declared controls for the default model via `getAdapterControls`, and `initialControls` overlays the saved values that the adapter actually offers
- [x] Neutral form for tool allow/deny rules — rules are `<tool>` / `<tool>(<glob>)` with adapter-neutral keywords (`shell`, `edit`, `read`, `web`, `agent`, `question`, `mcp`) matched by tool category; adapters build the call specifier with `toolCallSpecifier` (command, file path, URL, ...). Provider tool names (`Bash(...)`) keep working, so no migration
- [x] Switch agent mid-thread: picking another agent in the Agent settings popover hands the thread to it (`switchAgent` in `agent-session.ts`). The thread, worktree and checkpoints stay; if the user agrees, the next message carries a short transcript built from Grove's event log (`agent-handoff.ts`), so it didn't need the on-disk transcript after all
- [x] Agent discovery: Settings > Agents lists the ACP Registry's agents (`RegistryAgents.svelte`, fetched daily by `catalogs.ts`) with how to install each and a "Use" button that fills in the add form. Installing stays manual: Grove shows the install commands but never runs them
- [x] Agent Client Protocol for custom agent integration: `adapters/acp/`, with Gemini CLI and GitHub Copilot CLI built in, others added in Settings → Agent; see docs/acp-adapter-plan.md for what is left

### Embedded Terminal
- [x] Full working shell with color support and interactive command execution
- [x] Persistent shell state (env vars, directory changes across commands)
- [x] Per-session PTY terminals (split, toggle, resize, clear, restart)
- [x] Attach terminal output as context to AI messages — "To prompt" in the terminal toolbar inserts the selection (or the last 200 lines of scrollback) into the prompt as a fenced block and switches to Activity
- [ ] Choose the terminal's shell (PowerShell, cmd, Git Bash, WSL) in Settings; today it always starts `COMSPEC` (`terminal.ts`)

### Checkpointing & Revert
- [x] Git-based snapshots at each agent turn
- [x] Per-turn diff viewing (what changed in each turn)
- [x] Revert workspace to any previous turn's checkpoint
- [x] Preserve checkpoints across `/clear` — the git refs are kept and a `__clear__` sentinel checkpoint marks the boundary; `list()` flags earlier turns `beforeClear`, the Checkpoints tab shows them under a "Before /clear" divider with a files-only Restore (the conversation they belonged to is gone, so no conversation rewind is offered)
- [ ] Checkpoints for projects used without git. Today a folder project has none (`noGitCheckpoints` in `src/main/no-git-checkpoints.ts`), so only the conversation can be rewound. Grove takes the snapshot itself before each message, so any option below works for every agent and catches Bash edits (unlike the SDK's own `enableFileCheckpointing`, which is Claude-only and tracks only its file editing tools). First decide who it's for: users with git whose folder isn't a repository, or users with no git at all.
  1. Git kept outside the folder: a hidden repository in the app's data folder with the project as its work tree. Needs git installed; closest to `checkpoints.ts`, so the smallest change.
  2. isomorphic-git (pure JavaScript git): no git install, same format as 1. No diff command, so diffs come from the `diff` package; 4.9 MB; its README says it is run by two volunteers who "don't write much code".
  3. Own snapshots: hashed file copies plus a file list per turn. No dependency, byte-exact restores, Node's built-in hashing; we own storage, cleanup, ignore rules (`ignore` package) and Windows edge cases. Preferred if the goal is users with no git.

### Settings UI
- [x] GUI-based settings panel (no manual JSON editing)
- [x] Configurable UI layouts (full-featured to minimal)
- [x] Settings redesign: auto-save (no Save/Cancel; text saves after a pause, numbers on blur and only when valid), a left-hand list of sections, each with a grove name over its plain one (The grove / General, Grovekeepers / Agents, The gate / Permissions, Branches & roots / Git & worktrees, Bells / Notifications, Tending / Background work, Tool shed / MCP servers, Seed packets / Plugins, Hedges / Privacy) with search (`settings-search.ts`), `Ctrl+,`, confirm before removing an MCP server or plugin, and `--muted-foreground` raised to 4.5:1 contrast
- [x] Light theme (VS Code Light Modern): `globals.css` sets every token for `prefers-color-scheme: light`, which main sets from the Theme setting through `nativeTheme.themeSource` (so native menus and Preview pages follow it). Tailwind palette shades used for status colours (`text-green-400` and so on) are swapped for darker ones in light mode, checked by `light-theme.test.ts`; highlight.js and xterm have light themes. Theme picker is in Settings → The grove (General)

### Merge-Back Workflow
- ~~Merge a session's branch into the base branch from within the app~~ — implemented, then removed; sessions land their work through the PR workflow instead (local `git merge` from the terminal remains available for repos without a remote)
- [x] Rebase / cherry-pick / squash between agent branches — "Branch…" in the Changes tab opens `GitOpsDialog` (rebase onto the base or another session's branch, squash every commit since the base into one, cherry-pick a commit from another session's branch); operations refuse on a dirty tree and any conflict is aborted and reported with the file list, so the branch is never left mid-operation

### OS Notifications
- [x] Native notification when an agent finishes a turn while the window is unfocused
- [x] Native notification when an agent is blocked on a permission prompt or question, and for PR-watch alerts (new CI failure / review comments / needs-human)
- [x] Taskbar flash while a notification is pending (cleared on focus); clicking a notification jumps to the session
- [x] Sidebar attention flash extended to PR alerts (previously only status-bar chips)
- [x] Overlay badge on the taskbar icon showing the count of sessions needing attention — renderer draws the count bitmap (`attention-badge.ts`), main applies it via `setOverlayIcon` (Windows) / dock badge (macOS) / `setBadgeCount` (Linux); toggle in Settings → Notifications

### Attention Triage
- [x] Sidebar filter chips All / Needs you / Working / Unread / Idle with counts — `session-triage.ts` puts each session in exactly one state (needs-you = pending permission or question, working = turn in progress, unread = finished while unfocused, idle = open and ready or sleeping; closed and errored threads come under no chip)
- [x] Per-repo attention counts on each Projects header
- [x] Mark Completed in the conversation context menu and the row's hover tick: stops the conversation (it was called Stop), which takes it off the Conversations list, and its state shows as Completed. A separate `completedAt` hide flag was dropped as it overlapped with Stop. Since renamed Close Conversation, with an ✕ in place of the tick, as it's used to set work aside as much as to finish it
- [x] Sidebar sections renamed: Conversations (live working set) and Projects (each repo with all its sessions)
- [x] Persist the unread flag across restarts — `unreadSessionIds` in app-state.json, restored after worktree restore
- [x] Follow-ups: any agent (Claude Code and ACP agents) adds work for a later thread with Grove's `grove-followups` tools (`followup_add`, `followup_list`, `followup_done`, run without a prompt like memory). Saved per project in `follow-ups.json` (userData), so every thread sees a new one at once whatever its branch; new threads get the open titles in their system prompt. The Follow-ups drawer (sidebar footer, docked like Bookmarks) starts a thread from one by filling the New thread draft, links the thread that started, and keeps done ones with the agent's note (`main/follow-ups.ts`, `FollowUpsDrawer.svelte`, `docs/help/follow-ups.md`). Left to do: a run in the packaged Windows app with each agent, and adding a follow-up by hand
- [ ] Sidebar thread lifecycle: pin a thread to the top, drag to reorder, snooze a thread until a chosen time, optionally close threads idle for 7 days or whose PR merged, and Undo (`Ctrl+Z`) after closing or removing one. Today there is the To do flag, Name/Age sort and a manual Close; undo exists only for a discarded draft (`DraftUndoToast.svelte`)
- [x] Agent monitor: every open thread in every project in one dialog, with what its agent is doing now, its running subagents (Claude Code) and the shells and monitors it left running; Interrupt a turn, Stop a background subagent, shell or monitor, or jump to the thread. Opened from the title bar's needs-you and working counts (counted as the chips are) or Ctrl+Shift+A (`AgentMonitorDialog.svelte`, `lib/agent-monitor.ts`). Left to do (processes and memory, ACP agents' subagents) in `docs/agent-monitor-plan.md`

### Robustness
- [x] Global error handling — `crash-handling.ts` installs `uncaughtException` / `unhandledRejection` handlers in main (file log + forwarded to the renderer as a toast); `error-handling.ts` hooks `window.onerror` / `unhandledrejection` in the renderer (toast + file log via IPC); `<svelte:boundary>` around the sidebar and each session pane with a Reload view button
- [x] Opt-in crash reporting — "Send crash reports" toggle under Privacy (requires analytics on); uncaught errors from either process go to PostHog `captureException` with message, stack, source and kind only
- [x] Schema versioning + migration for persisted state — `persisted-state.ts` (top-level `schemaVersion`, ordered migration table, newer-file handling); settings.json and app-state.json are migrated on load, then validated field by field with Zod so one corrupt value resets to its default instead of dropping the file. Worktree manifest still unversioned.
- [x] Close to tray: Settings > General > When you close the window: Quit Grove Bench (the default) or Keep running in the tray, which hides the window and keeps the threads working (`close-to-tray.ts`). The tray icon opens the window on a click; its right-click menu shows how many threads are working or need you (the taskbar badge's count), with Open and Quit. The first time the window closes with threads working, a dialog offers the tray (Keep running in the tray, Quit, Cancel); the first time it goes to the tray, a notification says where it went. Either is shown once (app-state `trayIntroduced`). Left to do: try it in the installed app on Windows (the icon, the menu, the notification, and Windows shutting down with the window in the tray); a Quit button on the notification, as on the canvas (Windows needs custom toast XML for buttons in Electron)
- [ ] Continue turns that were cut off: after a crash, an update or a restart, offer to continue a turn that was running when the app stopped, instead of leaving the thread idle
- [ ] Code signing for the Windows installer (Azure Trusted Signing or a certificate). Installers are unsigned, so SmartScreen warns on first run and antivirus tools can flag them (`electron-builder.yml`; options in "Code signing" in `docs/electron-install.md`)

## Priority 2 — Notable Gaps

### Diff Viewer
- [x] Side-by-side diff view option (toggle in Edit tool header)
- [x] Syntax highlighting in diff views across multiple languages: `DiffView` highlights by file extension (`languageForPath` in `lib/diff-highlight.ts`, grammars registered in `lib/hljs.ts`) whenever it's given a `filePath`
- [x] Syntax highlighting in the thread's edit blocks (`DiffBlock.svelte`) and permission prompts (`PermissionBlock.svelte`): they pass `filePath` with `deferHighlight`, so `DiffView` draws plain lines and colours them once on screen, in idle time, a slice of lines at a time (`whenOnScreen` in `lib/code-highlight.ts`, shared with Markdown code blocks), keeping the colours per diff rather than in the shared cache. Lines over 2,000 characters and diffs over 5,000 distinct lines stay plain there (`linesToColour`). Colouring as they rendered would cost about 200 µs a line (a 2,000-line write is about 400 ms), the same freeze code blocks had when a thread woke
- [x] Full thread diff view (cumulative changes across all turns) — "All turns" entry in the Checkpoints tab, plus per-turn diff stats and a This turn / Since here toggle

### PR Creation Workflow
- [x] Dedicated PR creation dialog (title, body, base branch, draft)
- [x] Auto-populate PR title/description from the branch's commits
- [x] Call `gh pr create` from within the app (auto-pushes the branch first)
- [x] One-click Create PR sends a turn to the session's agent (commit → push → PR); manual dialog is the fallback for stopped sessions
- [x] PR status watching — state, checks rollup, review decision polled in the status bar (all sessions, not just the open tab)
- [x] Multiple PRs per session — every PR on the session's branch and on branches checked out in it (via the HEAD reflog) is listed; one primary PR (open first, newest first, or user-picked) drives alerts and auto turns
- [x] One-click fix turns — clickable failing-checks / changes-requested badges send the agent to read CI logs or review comments and fix
- [x] New-failure / new-comment detection with pulsing alert chips (baseline seeded on startup, one alert per pushed commit)
- [x] Opt-in auto mode per thread: auto-fix CI and auto-address reviews (sent while idle, or queued until the thread is free, dropped on Stop; ticking auto-fix acts on checks already failing, and ticking it again after "needs human" gives 2 more tries; max 2 fix attempts per PR until CI goes green, then "needs human"; collaborator-authored comments only)
- [x] Commit & Push and one-click push (↑n) from the Changes panel / status bar
- [ ] PR actions in the app: merge (merge, squash or rebase), mark ready for review or back to draft, turn auto-merge on or off, close and reopen, update the branch, and delete the branch after merging. Today `gh.ts` only creates, views and lists PRs, and the ship track sends the user to GitHub to mark a draft ready and to merge (`ship-track.ts`, `merge-on-github`)
- [ ] PR conversation in the app: read review threads, reply, resolve, request reviewers, set labels, and sync viewed-file marks with GitHub. Today the user can post one review on the thread's own PR (`pr-review.ts`, `PrReviewDialog.svelte`) and viewed marks are local only (`review.svelte.ts`)
- [ ] PR tools for agents: Grove tools to read and update the thread's PR, read CI logs, reply to reviews, and watch the PR so the agent wakes when it starts to conflict, required checks pass or an approval is needed. Today auto-fix CI and auto-address reviews are user toggles, and a conflicting PR never starts a turn
- [ ] Link any PR to a thread, including one from another repository or a fork. Today PRs are found from the thread's branch and its reflog only (`sessionPrBranches` in `ipc.ts`), and fork PRs are filtered out of the start picker (`DraftStartPicker.svelte`)

### Session Search
- [x] Fuzzy search to find and resume past conversations (Ctrl+R)
- [x] Filter/search within message history (Ctrl+F with highlighting)

### Help System
- [x] Keybinding documentation (F1 or similar) — `F1` opens Help, and the empty state links to Getting Started
- [ ] Context-aware footer showing relevant keyboard shortcuts. The status bar's "Keys" list was dropped with the lozenge redesign; every shortcut is under Keyboard Shortcuts in Help (`F1`), whatever has focus

### Cost & Usage Dashboard
- [x] Plan usage runway — `AgentQueryHandle.getUsage()` returns a neutral `ProviderUsage` (windows with 0–1 utilization and reset time); the Claude adapter maps the SDK's experimental `/usage` control and probes for it so a rename degrades to "no usage"; `usage.svelte.ts` keeps one snapshot per provider, refreshes on popover open and after turns (throttled), and folds live `rate_limit` events in; shown as bars under the agent in the Agent settings popover
- [x] Per-thread and daily cost: the Last turn row in the status bar's Activity popup shows what the thread and today (every thread since midnight) have cost so far (`StatusBarLastTurn.svelte`), from the figures the spend limits count (`threadSpend` in `agent-session.ts`, `todaySpend` in `session-limits.ts`), with a link to the limits. The thread's total and its allowance past the spend limit are saved in the worktree manifest (after a costed turn, on Continue, and before a rewind or /clear), so a rewind, /clear or restart doesn't lower the total or reset the thread's spend limit. The dollar rows show only where the last turn's cost is (API sign-ins, and agents that report cost but not plan usage)
- [x] Token counts per thread: tokens in and out for the thread, in the Usage popover for every sign-in. Claude Code's `modelUsage` is a running total (subagents included, input counts cache reads and writes), so `RunningTokens` in `adapters/running-cost.ts` turns it into each turn's `turnTokens`; ACP agents pass on session/prompt's `usage`, which is the turn's own. `session-limits.ts` adds them up and they're saved in the manifest with the spend. The context popover's output figure now comes from these totals: it added up each reply's `output_tokens`, which the SDK sets when the reply starts and repeats on every message of it (https://code.claude.com/docs/en/agent-sdk/cost-tracking#read-output-tokens-from-the-result-message)
- [x] Turn cost per turn: Claude Code's `total_cost_usd` is the query's running total, so `adapters/running-cost.ts` turns it into each turn's cost (`totalCostUsd`) and keeps the running total as `sessionCostUsd`; a resumed query starts from the total its history last reached
- [x] Limits and alerts (Settings > Limits & alerts): plan usage alert at a chosen percent (in-app toast and desktop notification, once per window, `planAlerts.svelte.ts`); spend per thread and per day, tool calls and minutes per turn, each pausing the thread before its next tool call to ask Continue or Stop (`session-limits.ts`, a `PreToolUse` hook for Claude Code, permission requests for ACP agents)
- [x] Usage across threads and models (Settings > The harvest, and **All usage** in the Activity popup, `UsageReport.svelte`): cost, tokens, agent time and turns over Today, 7 days, 30 days or All time, by model and by thread, removed threads included. Each result carries `at` and `models` (the turn split by model: `RunningModels` in `adapters/running-cost.ts` from Claude Code's per-model `modelUsage`, ACP agents' current model), and main appends every turn to `usage-ledger.jsonl` (`usage-ledger.ts`), so removing, rewinding or clearing a thread doesn't lower the totals. Older turns are added once from threads' event logs, with no model and dated by their prompt
- [ ] Usage: keep the ledger small by rolling turns older than about 90 days into daily totals (it grows about 250 bytes a turn and is read whole on first open)
- [ ] Usage: cost per day as a chart, open a thread from its row, export as CSV, and show **All usage** in the Activity popup before a thread's first turn ends
- [ ] Usage: plan limits for agents other than Claude (only `claude-code.ts` implements `getUsage`), and custom prices per model for agents that don't report cost
- [ ] Resume at reset: when a plan limit pauses the queue, offer to send the next message automatically when the window resets. `rateLimitStore` already has `resetsAt`, but today the queue waits for a manual Resume

### Session Export
- [ ] Markdown transcript per session written to disk (`.grove-wt/<id>/thread.md` or under the repo's memory dir) with an "Open in editor" action
- [x] Export a thread (Markdown / JSON): **Export Thread…** in the sidebar's thread menu asks where to save it (`SESSION_EXPORT` in `ipc.ts`, `thread-export.ts`). Markdown has the messages (what was typed, not the contents of attached or @-mentioned files), proposed plans and the user's answers, a line per tool call and errors, without tool output, thinking or subagents' work; JSON has every saved event
- [ ] Session export/import between machines

### Security Hardening
- [ ] Validate IPC inputs at the boundary with Zod (a dependency, not used for IPC yet). This is robustness more than security: the renderer can already run any command through the terminal (`PTY_WRITE` in `ipc.ts`), so the CSP and the sandbox are what stop injected script, not argument checks. Most of the 184 handlers type their arguments without checking them at run time; a few check by hand (`typeof`). If done, start with the handlers that take objects, or pass paths and branch names on to git or the file system
- [x] Electron sandbox for the app window: on by default since Electron 20 unless `nodeIntegration: true` or `sandbox: false` is set, and the main window sets neither (`src/main/index.ts`). The preload only uses `contextBridge` and `ipcRenderer`, which work sandboxed. The Preview pages set `sandbox: true` themselves
- [x] Content-Security-Policy for the renderer: a `<meta>` tag added at build time by `scripts/vite-csp.mjs` (only the app's own scripts, no inline scripts or eval, local images only)
- [ ] Secrets: secret references (such as 1Password `op://` paths) in any key field, and a way for an agent to ask for a secret in a private prompt so the value never enters the thread. Today `credentials.ts` keeps one API key per agent with safeStorage

### Onboarding
- [ ] First-launch welcome/tour surfacing the existing `docs/help/` content (currently only the git notice, the API key step in New Conversation, and analytics consent)

## Priority 3 — Nice to Have

### Deployment Options
- [ ] Web mode — serve as browser-accessible app (`npx grove` / `grove-bench serve`)
- [ ] Standalone CLI mode without full Electron app
- [ ] Zero-install entry point via npx
- [ ] Remote access from another machine or a phone (LAN pairing, Tailscale, SSH), with phone alerts when a thread needs you. Needs web mode first: today all state lives in Electron main and the window reaches it only through `preload.ts`
- [ ] Agents outside Grove (Claude Code in a terminal, other MCP clients) list, start and message Grove threads over MCP, with an access level the user picks. Today Grove's MCP server listens on loopback only and serves Grove's own agents (`grove-mcp-http.ts`)

### Platform
- [ ] Native Linux/macOS support and testing (currently Windows-focused)
- [ ] WSL: run a project's agents, git and terminals inside a WSL distro when the project lives there. There is no WSL support in `src/main` today
- [ ] winget and Scoop packages for the installer

### Updates & Policy
- [ ] Update channels: a Stable / Beta choice in Settings. Today there is one weekly train, and an alpha install follows pre-releases only implicitly (`docs/auto-update-plan.md`, `auto-updater.ts`)
- [ ] Managed policy for teams: settings an admin locks through Group Policy (HKLM) or a JSON file, such as the broadest permission mode, which agents are allowed, analytics and the update feed

### Clipboard
- [x] Copy buttons on code blocks, bash output, diffs, file ops, thinking blocks

### Accessibility & i18n
- [ ] ARIA roles/labels on app components (80 of 122 app components have `aria-*` or `role` attributes; the other 42 have none)
- [x] `prefers-reduced-motion` support: `globals.css` stops the pulses, the tooltip and the empty-state animation, and animated components check it themselves (`GroveWalk`, `AgentSprite`, `StatusDot`, `PixelMeter` and others). Loading spinners still turn
- [ ] i18n framework (all UI strings hardcoded English; spellchecker pinned to `en-US`)
- [ ] Screen-reader announcements when a background thread finishes or needs you, and the thread's status in the window title (today `aria-live` is used only in settings and popovers)

### Maintenance & Hygiene
- [x] ESLint (typed rules, run in CI; errors it found at the start are listed in `eslint-suppressions.json` and fixed over time) and knip for unused files, exports and dependencies
- [ ] Prettier config
- [x] Tests for the IPC layer: `ipc.test.ts` covers handler validation, file access bounds, setup cancel and history paging
- [ ] Component tests (54 of 122 app components have their own test file) and E2E tests (Playwright)
- [ ] In-app log viewer and a log level setting. Today Settings > Diagnostics can open the logs folder ("Show performance log"), and the level is set with the `GROVE_LOG_LEVEL` env var (`logger.ts`)
- [ ] Worktree disk-usage reporting and a "reclaim space" tool
- [ ] Measure live conversation memory: a running conversation keeps every non-streaming event in memory for its whole life (`SessionEventStore.append`); log history size per conversation, and if it's large, keep only recent events in memory and read older ones from the JSONL log
- [ ] Purge userData on uninstall (NSIS currently leaves settings/logs/worktrees behind)
- [ ] CHANGELOG.md and SECURITY.md
- [ ] `findSiblingNodeModules` in `worktree-manager.ts` is never called: use it for the `node_modules` copying item below, or remove it
- [ ] Performance budgets in CI: comment on or fail a PR when startup time, IPC payload sizes or bundle size grow past a budget. CI runs typecheck, tests, build, lint and knip today
- [x] Fetch Claude model list dynamically — the adapter reads `Query.supportedModels()` when a conversation starts (once per run), keeps the concrete model ids, caches the list in app-state for the next launch and falls back to `FALLBACK_MODELS` before the first read; the SDK's effort levels, adaptive thinking, fast mode and auto mode override the static rules in `claudeControlsFor()` (default effort and thinking-off still come from the table)
- [x] Demo harness (`/demo.html`) console errors: the duplicate keyed-each id in the Sidebar demo data and the missing mock bridge methods (`checkPrerequisites`, update listeners) are fixed; the page now loads on the dev server with no console errors

### From DESIGN.md v2 (documented but previously untracked)
- [ ] Docker-based sandboxing of agent sessions
- [ ] Shared CLAUDE.md / agent instructions per worktree
- [ ] Per-repo agent instructions field in Settings (writes to `CLAUDE.md` or a memory `conventions/` note); today only the global system-prompt append exists
- [ ] Agent-to-agent communication (one agent's output feeds another). A concrete first step: Grove tools that let an agent start a thread on any agent and model (in its own worktree if asked), wait for it, check on it or cancel it. Today Grove's tools cover memory, follow-ups and Preview only (`adapters/grove-tools.ts`)
- [ ] Orchestration engine (goal decomposition → parallel tasks → integration merge agent) — prototyped and removed; see user stories 20–28 in `docs/user-stories.md`
- [ ] Worktree dependency optimizations: copying `node_modules` from another worktree when the lockfile matches, `node_modules` symlinking from main checkout (DESIGN.md §6.1)

## Feature Requests

### Input & UX
- [x] Auto-grow input with max height and manual resize
- [ ] Markdown rendering in input (preview mode)
- [x] Context length indicator (token usage / remaining)
- [x] Drag and drop (files, images into prompt)
- [x] Image attachments in messages (paste/drop, up to 8 per turn, pass as base64)
- [ ] Prompt history: ArrowUp in an empty prompt brings back earlier prompts (`PromptEditor.svelte` uses ArrowUp only inside its pickers)
- [ ] Large pastes (32 KB or more) become a text file attachment instead of filling the prompt (`handlePaste` in `PromptEditor.svelte` only handles images)
- [ ] Prompt stash: put a draft aside and bring it back later (`Ctrl+S` already saves a skill, so it needs another key)
- [ ] Thread and PR references in the prompt: `@thread` or `#PR` adds that thread's summary or the PR's details as context, and dropping a sidebar thread on the prompt does the same. Today `@` picks files only (`lib/file-picker.ts`)
- [ ] Send one prompt to several agents or models, each in its own thread and worktree, and start a thread in the background without switching to it. Today a draft starts one thread on one model (`draft.svelte.ts`)
- [ ] Voice dictation in the prompt
- [ ] Attach files to an answer to the agent's question (`QuestionBlock.svelte` has no attach)
- [ ] Find (`Ctrl+F`) in diffs and on Preview pages. Today it works only in the thread (`OutputPanel.svelte`), and main has no `findInPage`
- [x] Any file as an attachment: saved with the thread and given by path (Claude Code: a note, and reads in that folder allowed without a prompt; ACP: `resource_link`). Only audio goes inline, to ACP agents that take it (listed formats, 5 MB a clip, 10 MB per conversation counted from the thread's history). PDFs go by path: inline ones stay in the history and count toward every later request's size and page limits. 50 MB per message

### Markdown Preview Panel
- [x] Focus panel rendering markdown, docked beside the thread between its tab bar and bottom bar so the message box stays usable (reuses the marked + highlight.js + DOMPurify pipeline; Esc from inside it or × to close, drag to resize, copy button). The Subagent panel and Bookmarks dock the same way (`SideDock`)
- [ ] Mermaid diagrams in messages, and maths (KaTeX) as an opt-in setting. Markdown goes through marked only today
- [ ] HTML replies drawn in a sandboxed frame in the thread, and MCP Apps. Today an HTML file in Files made opens in the Preview tab
- [x] Hover "Focus" button on in-turn assistant responses with document-like markdown (≥2 headings, a table, ≥3 code fences, or structure + length) — works in both Detailed and Summary view modes
- [x] "Focus" on plan-approval blocks so a proposed plan can be read in the Focus panel before approving
- [x] Secondary: preview `.md` files the agent writes: **preview** on an edit block, **Preview** in the Changes tab, and links to `.md` files in replies open the file as it is now in the Focus panel (`openWorktreeFile` returns its text, up to 1 MB; `isMarkdownFile`). Markdown stays out of "Files made", which lists output, not files edited as source. Not done: a preview in the @ file picker

### Agent Capabilities
- [x] `/rewind` — Roll back to a previous message checkpoint, restoring files on disk (SDK: `query.rewindFiles()`). See `docs/rewind-plan.md`
- [ ] `/btw` — Ephemeral side question that doesn't enter conversation history. Runs while agent is working, no tool access, shows in dismissible overlay. No SDK support — needs separate `query()` call with `maxTurns: 1`
- [x] Commands (slash commands for common actions)
- [x] Skills (reusable prompt templates / workflows)
- [ ] Scheduled skills (what "Recipes on top of skills" became): a Skills drawer (in place of the popover) with This thread (Run and Schedule on each skill, for every agent: Grove reads Gemini CLI's, Copilot's, OpenCode's and custom agents' skill folders as well as Claude Code's) and Scheduled (every project's schedules). Proof of concept done (`src/main/skill-schedules.ts`, `SkillsPanel.svelte`, `docs/skill-schedules-plan.md`); left to do: a run in the packaged Windows app, a help page, and removing a project's schedules with it
- [x] MCP server connections (connect to external MCP servers)
- [x] A thread's tasks and files in the status bar's Activity popup: **Tasks** shows the agent's current to-do list (Claude Code's TodoWrite or TaskCreate/TaskUpdate, an ACP plan, OpenCode's todowrite) and **Files** lists the files you attached, the agent made and tools returned. Built in main from the whole history (`shared/thread-items.ts`), so a list started before the loaded page still shows; each item can jump to its message

### Git & Workflow
- [x] Branch → PR link (create PR from session branch)
- [x] Branch without worktree (use existing checkout, no worktree creation)
- [ ] Stacked branch workflows (dependent branch chains)
- [x] Submodules in new worktrees: `git worktree add` leaves them as empty folders, so setup can run `git -c submodule.active=. submodule update --progress` (with `--recursive` for All levels) for a project with a `.gitmodules`, right after the worktree is made: before files are copied in and before the dependency install. No `--init`, so the project's shared `.git/config` isn't changed; a project's own `submodule.active` pathspecs are passed on. It runs in the agent host with no terminal prompt, ssh in BatchMode unless the user has their own ssh, and stops once git writes nothing for 5 minutes (`worktree-submodules.ts`). Settings > Git & worktrees: All levels, Top level only or Off, off by default. A failure is reported in the thread, which still starts. Left to do: checkpoints and rewind that cover the files inside submodules (then it can default to All levels), and the Changes tab showing a submodule's own files rather than one row for the folder; a choice per project once projects have settings; optional sparse-checkout patterns
- [ ] Worktree cleanup rules per project: remove a worktree after N idle days, after its PR merges, or when it holds nothing new, with a choice of which local changes protect it. Recreate a thread's missing worktree on its next turn instead of removing the thread (`cleanupOrphans()`). Related: "Worktree disk-usage reporting" under Maintenance
- [ ] Review one commit at a time in the Changes tab (today only Branch and Uncommitted), and leave files a pull, merge or rebase brought in out of a turn's diff. `checkpoints.ts` diffs one checkpoint against the next, so a turn that merges main shows all of main's changes
- [ ] Issue trackers: an Issues view (GitHub first, then Linear and GitLab), link an issue to a thread, start a thread from one, and agent tools to create, link and close issues. Today follow-ups are a local list only (`follow-ups.ts`)
- [ ] Git hosts other than GitHub (GitLab, Bitbucket, Azure DevOps, Forgejo/Gitea). PR and CI features work only through `gh` today
- [ ] Projects with several repositories: a worktree per repository on one branch, with diffs and git actions per repository (Goal 2 in `docs/projects-plan.md`)
- [ ] New project from scratch or from a clone URL, and publish a local project to GitHub. There is no clone or `gh repo create` in `src` today
- [ ] Keep the base branch current: an optional fetch and fast-forward of the default branch on a timer. Today `pullBaseBranch` runs only when a worktree is created

### Configuration
- [ ] Customizable keybindings (`~/.grove-bench/keybindings.json`)
- [ ] Command palette (`Ctrl+K`) that runs actions (new thread, switch tab, open a setting, git actions), not just finding threads; `ui/command/command-dialog.svelte` is in the kit but unused. `Ctrl+R` stays as thread search
- [ ] Keyboard navigation: `Ctrl+1` to `Ctrl+9` to jump to a thread, `F6` to move between areas, arrow keys, `F2` and `Shift+F10` in the sidebar, and back/forward between threads
- [ ] Project scripts (user-defined scripts bound to keyboard shortcuts, and optionally run when a worktree is created or a thread is closed)
- [ ] Settings per project: base branch, branch naming, default permission mode, and the files copied to new worktrees (today `DEFAULT_COPY_PATTERNS` in `worktree-manager.ts` is fixed and can't be edited in the app). Settings are global today except `repoColors` (`settings.ts`)

### Dev & Preview
- ~~Localhost run (start/preview dev server from worktree)~~ — implemented, then removed; run dev servers from the session terminal instead
- [x] Preview tab (`Alt+5`) — a browser per conversation with two pages sharing storage: yours (a `WebContentsView` over the tab) and Claude's (an offscreen page driven by the `grove-preview` MCP tools: open, screenshot, read, logs, click, type; local URLs only). Localhost links in the conversation open there; addresses dev servers print are offered in the empty tab
- [ ] Named background commands — a list of long-running processes with Running/Stopped state, Stop, follow-the-log, wrap, and downloadable output, decoupled from the session PTY (a narrower reimplementation of the removed dev-server feature)

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

## Strengths to Keep

- **Project Memory System** — persistent markdown notes (repo, conventions, architecture, sessions)
- **Orphan Worktree Detection & Cleanup** — auto-detect on startup + 15-min background sweeps
- **Auto-Copy `.env` Files** — automatically copies `.env`, `.npmrc`, etc. to new worktrees
- **Auto-Install Dependencies** — optional install in new worktrees with the project's package manager (npm, pnpm, Yarn, Bun), from the user's own cache
- **Tool Visibility Control** — allow/deny rules with glob patterns, matched by tool category across agents
- **Conflict Handling Between Threads**: rebase, squash and cherry-pick between threads (`GitOpsDialog`), and Mark resolved in the review panel (`ReviewDiffPanel.svelte`)
- **Power Monitoring** — flush state on suspend, health-check on resume
- **Changes Review Panel** — dedicated panel with file staging/unstaging, revert individual files
