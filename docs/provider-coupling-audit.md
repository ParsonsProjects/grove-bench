# Provider coupling audit

> **Status: findings only, nothing changed yet.** Checked on 14 October 2026
> against `c0249cf`. Every line reference below was read in the code, not
> inferred. The plan at the end needs the answers in [Open questions](#open-questions)
> before work starts.

## Short answer

Grove is not tightly bound to the Claude Agent SDK any more. The SDK is
imported in three files only (`adapters/claude-code.ts`, `adapters/sdk-mcp.ts`,
`adapters/running-cost.ts`), and Gemini CLI, Copilot CLI and OpenCode already
run through the ACP adapter (`docs/acp-adapter-plan.md`).

What is left is smaller and more scattered:

1. **About a dozen leaks** where shared code still assumes Claude, so other
   agents get wrong behaviour (a prompt that should not appear, a hidden tool
   call, a rule that never fires, content sent to Claude).
2. **Grove's own rules live inside each adapter**, written twice. The two
   copies have drifted, and ACP misses some of them.
3. **Some shared types are shaped like the SDK** (event names, permission
   modes, `mcp__` tool names, question and sub-agent payloads). They work,
   but each new agent has to imitate Claude to use them.

So the job is not "extract Grove from the SDK". It is "move Grove's rules out
of the adapters and give the shared types neutral fields".

## Already neutral

- `AgentAdapter` with capability flags, declared controls and per-adapter
  models, keys and sign-in (`adapters/types.ts`).
- `ToolView` for tool calls (`shared/tool-view.ts`); the UI and Read-safe mode
  read it, and fall back to Claude's names only for old history.
- Grove's memory and Preview tools defined once (`grove-tools.ts`) and served
  over MCP HTTP or stdio to non-Claude agents.
- System prompt text, Read-safe for asked calls, the sandbox choice and spend
  limits are built in the session layer, not in an adapter.
- Session tests mock the adapter registry, so the session manager is already
  tested without the SDK.

## Leaks: wrong behaviour for a non-Claude agent

| # | Where | What goes wrong | Size |
|---|---|---|---|
| L1 | `main/background-tasks.ts:28-32` | A thread whose agent is gone (say a custom ACP agent removed in Settings) has its commit messages, goals and memory notes run on the default agent, which is always Claude. Its content goes to Anthropic. This is written on purpose, but DESIGN.md says a thread's content only goes to the provider chosen for it. | S |
| L2 | `main/adapters/registry.ts:9-11`, `adapters/index.ts` | The first adapter registered is the default and nothing calls `setDefault`, so the default is always Claude Code with no setting. About a dozen `?? getDefault()` fallbacks depend on it. | S |
| L3 | `main/ipc.ts:1641-1643` (`resolveAdapter`), `ipc.ts:1035-1048` (skills), `worktree-manager.ts:1340` | An unknown or missing agent id quietly becomes Claude: Claude's MCP config, plugins, `.claude/skills` or `.claude/settings.local.json` get read or written instead of an error. | S |
| L4 | `main/session-config.ts:137-138` | The built-in prompt sent to every agent says to use "Read, Edit, Write, Grep, Glob" and "Bash". ACP agents get it too. | S |
| L5 | `main/agent-utils.ts:88` | The `mcp` rule keyword matches only names starting `mcp__`. ACP tool names come from the call's name, kind or title (`acp/mapping.ts:49-56`), so MCP allow and deny rules never fire for ACP agents. | S |
| L6 | `renderer/lib/message-view.ts:77-80` | Summary view (the default) keeps outside MCP calls only when named `mcp__server__tool`. Non-Claude MCP calls that act outside the project are hidden. | S |
| L7 | `main/adapters/claude-code.ts:1734-1751` | Grove's memory tools and Preview read tools are auto-allowed only for Claude, and by changing the session's own `alwaysAllowedTools` set. ACP serves the same tools but never auto-allows them, so an agent that asks before MCP calls prompts for every memory read. | S |
| L8 | `renderer/components/StatusBarContext.svelte:215`, `PromptEditor.svelte` command list | "Summarise to free space" sends `/compact` to every agent. ACP has no handling for it, so it goes to the agent as plain prompt text. No capability flag. | S |
| L9 | `main/agent-session.ts:661-682` | Memory autosave before compaction, and the "re-read your plan" nudge after it, run only on Claude's `compact_boundary`. ACP has no such signal. | M (needs a product call) |
| L10 | `renderer/stores/messages.svelte.ts:1978-1980, 2358-2368` | Question cards read Claude's `AskUserQuestion` input (`questions[].options`), and the answer goes back as a deny with the text as its message, which is Claude's convention. `ToolView` kind `question` carries no questions. Latent today: only Claude emits that category. | M |
| L11 | `renderer/components/PermissionBlock.svelte:153-159` | The prompt header reads only `file_path` or `command`, so read, search and other approvals from ACP agents show no target. `view.path` and `view.summary` are there but unused. | S |
| L12 | Rewind UI (RewindDialog, CheckpointsPanel, `/rewind`) | Nothing in the renderer checks `capabilities.rewind`. Main falls back to a new conversation and warns afterwards (`agent-session.ts:2075`). | S |
| L13 | `renderer/stores/messages.svelte.ts:2303-2306` | `/plan` and `/code` set the mode badge locally, without asking main, even for agents without those modes. | S |
| L14 | `main/adapters/claude-code.ts:139-160` vs `shared/tool-view.ts:93-148` | Claude's adapter categorises tools with its own switch, not `claudeToolView`. `NotebookEdit`, `LS`, `Task` and `WebSearch` land in `other`, so a neutral `edit` deny rule does not stop `NotebookEdit` and `read` does not cover `LS` (`agent-utils.ts:86-93` matches keywords by category). A Claude bug, caused by the duplicate code. | S |
| L15 | `main/adapters/acp/acp-adapter.ts:185` | ACP agents start with `execa` in the main process. #184 moved Claude's binary to the agent host because launches froze the window for 1 s or more. Not a straight swap: the host uses plain `spawn` (`process-host-spawn.ts:175`), and ACP agents are often npm `.cmd` shims, which need cross-spawn style handling on Windows. | M |

## Grove rules written twice

| # | Logic | Claude | ACP | What differs |
|---|---|---|---|---|
| D1 | Tool decision: allowed tools, rules, always-allow, attached files, edits inside the worktree | `canUseTool`, `claude-code.ts:1766-1847` | `autoDecision`, `acp-adapter.ts:1310-1338` | Different specifiers and categorisers (L14). ACP never allows reading attached files (Claude does at `claude-code.ts:1796`), so they prompt even in Read-safe. |
| D2 | Turn cost from a running total | `RunningCost`, seeded with `priorCostUsd` (`claude-code.ts:1935`) | Own subtraction, `acp-adapter.ts:876, 926` | ACP ignores `priorCostUsd`, so the first turn after a resume has no cost and spend limits miss it. |
| D3 | "Can't reopen this thread" | Throws `ResumeNotFoundError` | Emits its own status, `acp-adapter.ts:758, 762` | ACP's status has no `newConversation` marker, which rewind and the inline audio budget rely on. |
| D4 | Tool result size cap | `capToolResult`, `claude-code.ts:86-91` | None | ACP results go to history, the log and the renderer uncapped. |
| D5 | Auth error event | Always `keyRejected: true` | Works it out twice in the file | One helper would do. |
| D6 | Ask / Edit / Read-safe mode options | `claude-code.ts:869-877` | `acp-adapter.ts:106-110` | Same modes, different help text. |
| D7 | Key check, saved model list, image types | `verifyAnthropicKey`, model cache | `verifyGeminiKey`, `verifyOpenRouterKey`, `learnedAgent` | Same code three times or twice. |

## Shared types still shaped by the SDK

These work today. They matter for the next agent (a native Codex adapter is
in `TODO.md`).

- **`AgentEvent`** (`shared/types.ts:235-334`) mirrors SDK messages:
  `system_init`, `result` with a `subtype`, `compact_boundary`, `task_*`,
  `hook_event`, `auth_status`, `prompt_suggestion`, `tool_use_summary`,
  `files_persisted`, `rate_limit` with `rateLimitType`, and `mode_sync` with
  `source: 'sdk'`. Eleven event types are emitted only by Claude. Renaming
  them would break saved event logs, so I would keep the names and treat them
  as Grove's own words, adding neutral fields only where a second agent needs
  them.
- **`PERMISSION_MODES`** is Claude's list plus `readSafe`. `setMode` checks
  against it rather than the agent's declared options (`agent-session.ts:1107`),
  and `'auto'` is read as "accepts edits" (`:1123`), which is Claude's meaning.
- **`ToolView`** has kinds `question` and `agent` but no fields for the
  questions or the sub-agent's type and prompt, so the UI reads Claude's raw
  input (L10; `message-view.ts:34-41`). To-do lists are found by tool name
  (`shared/thread-items.ts:84-85`).
- **MCP tool identity** is the `mcp__server__tool` name (L5, L6). A
  `ToolView.mcp: { server, tool }` field set by each adapter would fix both.
- **Context size** falls back to 200k (`messages.svelte.ts:832`).

## Proposed plan

In order of value for effort. Each step is small enough for one PR and keeps
saved history readable.

1. **Stop the silent Claude fallbacks** (L1, L2, L3). Fail or skip when the
   agent is unknown, and add a "default agent" setting. Fixes the one privacy
   issue.
2. **One shared tool policy** (D1, L7, L14, L5). A `permission-policy.ts` with
   `decide(view, call, config, mode)` covering allowed tools, rules,
   always-allow, attached files, Grove's own tools (matched by server, not by
   `mcp__` name) and edits inside the worktree. Claude builds its view with
   `claudeToolView`; both adapters call the policy, and Claude keeps only its
   sandbox checks.
3. **Small shared helpers** (D2 to D7, L4). `RunningCost` in ACP, the resume
   error, a central tool result cap, one auth error helper, shared mode
   options, one key check helper. Reword the path rules prompt without tool
   names.
4. **Capability-gate the UI** (L8, L12, L13, L11). A `compact` capability (or
   a declared command), check `rewind` before offering it, route `/plan` and
   `/code` through main, use the view in the permission header.
5. **Neutral payloads in `ToolView`** (L6, L10, sub-agents, to-dos). Add
   `mcp`, `questions`, `agent` and `todos` fields, filled by each adapter, with
   Claude's reading as the fallback for old history.
6. **Agent host for ACP** (L15). Needs `.cmd` shim handling in the host first.
7. **Compaction for other agents** (L9). Needs a product decision: run the
   memory save on a token threshold instead of the agent's own signal?

## Open questions

- What is the goal: better parity for ACP agents, a native adapter for a
  specific provider (Codex app-server is in `TODO.md`), or calling model APIs
  directly with Grove running the agent loop itself? Step 5 matters a lot for
  the second and third, less for the first.
- Should Claude stay the fixed default, or should the user pick?
- For a thread whose agent is gone, should background tasks be skipped, or
  ask the user, rather than going to Claude?
- Is it fine to add fields to `AgentEvent` and `ToolView` but keep the
  SDK-style event names, so old logs keep loading?

## Not checked

- Real runs of Gemini CLI or Copilot CLI; this is a code reading only.
- `landing/`, `scripts/` and the help pages under `docs/help/`.
- Whether any ACP agent in use today asks before MCP calls (L7 only bites
  for one that does; OpenCode does not, per `docs/open-model-harnesses-plan.md`).
