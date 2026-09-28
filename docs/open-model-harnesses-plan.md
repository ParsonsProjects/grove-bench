# Open-Model Harnesses (ACP)

> **Status: Proposal.** Nothing here is implemented yet. Facts about outside
> projects were checked on 28 September 2026 and are linked in
> [Sources](#sources). Items marked **(verify)** are unconfirmed and are the
> job of Phase 0.

## Goals

1. Run a Grove conversation on a non-Anthropic model, starting with
   DeepSeek V4.1 Flash.
2. Do it through an open-source agent harness, not by pointing Claude Code at
   another model.
3. Add the integration once, so more harnesses cost a small profile each, not
   a new 1,700-line adapter.

## Decisions

| Question | Decision |
|---|---|
| Integration route | One generic **Agent Client Protocol (ACP)** adapter. Grove acts as the ACP client, the harness is the ACP agent. |
| First harness | **OpenCode** (`opencode acp`). |
| Model provider | **OpenRouter**, with the user's own key. DeepSeek direct and local models are out of scope for v1. |
| Getting the harness | **Detect on PATH** and show install steps when missing, like the Claude CLI check today. No bundling. |

## Why ACP, and why not the other routes

| Route | Verdict | Reason |
|---|---|---|
| Generic ACP adapter | **Chosen** | ACP is a JSON-RPC 2.0 standard between editors and coding agents [1]. The TypeScript SDK `@agentclientprotocol/sdk` is at 1.5.1, Apache-2.0 (`npm view`). The ACP registry lists about 50 agents, including OpenCode, Goose, Qwen Code, Gemini CLI, Kimi CLI and Codex CLI [2]. One adapter, many harnesses. |
| Dedicated OpenCode SDK adapter | Later, maybe | Richer (session revert/unrevert, fork, provider lists, todos), MIT, but tied to one vendor. It runs a local HTTP server, and OpenCode had an unauthenticated-server RCE, CVE-2026-22812, fixed in 1.0.216 [3]. The SDK also ships a `v2` folder, so its API is still moving. Worth revisiting only if ACP's gaps (rewind, models) hurt. |
| Claude adapter pointed at another endpoint | Rejected | DeepSeek offers an Anthropic-format endpoint that Claude Code can use [4], but Anthropic's docs say it "doesn't support routing Claude Code to non-Claude models through any gateway" [5]. Claude Code is also not open source, so it misses goal 2. |
| Codex app-server | Rejected for this goal | Codex removed the Chat Completions wire API in February 2026; only `wire_api = "responses"` is accepted [6]. DeepSeek's own API is Chat Completions and Anthropic format [4], so it needs a gateway. Codex stays on `TODO.md` as its own adapter and can also come in through ACP (`@zed-industries/codex-acp`). |

## The model: DeepSeek V4.1 Flash on OpenRouter

- Released 10 September 2026 [7]. On OpenRouter the slug is
  `deepseek/deepseek-v4.1-flash`, with a 1,048,576-token context, text and
  image input, and tool calling on 25 of 26 serving providers [8].
- Price on OpenRouter at time of writing: about $0.03 per million input
  tokens and $0.60 per million output tokens [8]. Prices change; the app
  should read them from OpenRouter, not hard-code them.
- DeepSeek retired V4-Flash; its old id now routes to V4.1 Flash [9]. The
  default model id must be easy to change without a release (see Models).

## The harness: OpenCode

- MIT licence, version 1.18.33, with `opencode-windows-x64` and
  `opencode-windows-arm64` binaries (`npm view opencode-ai`).
- `opencode acp` runs OpenCode as an ACP agent over stdio [10].
- OpenRouter is a built-in provider; model ids are written
  `openrouter/<slug>` [11].
- Config can be passed per process: `OPENCODE_CONFIG` (file path) and
  `OPENCODE_CONFIG_CONTENT` (inline JSON) [12].
- **Known ACP gaps.** OpenCode's ACP mode has had no way for a client to pick
  the model per session; the model came from config at startup [13].
  There is also an open request to expose automatic approval through ACP [14].
  Both were reported on older versions **(verify on 1.18.x)**. The design
  below works even if they are still open.

## Where we are today

The adapter layer is ready for a second agent. The rest of the app is not
fully. From an audit of the code (line numbers at commit `f880fe3`):

**Already adapter-neutral**
- `AgentAdapter` / `AgentQueryHandle` in `src/main/adapters/types.ts`, with
  capability flags, `getControls(model)`, optional `apiKey`,
  `backgroundModel` and `generateText`.
- The registry, per-adapter settings, saved keys and default models
  (`DESIGN.md`, "Several agents"). The New Conversation dialog shows an agent
  picker once two adapters are registered
  (`src/renderer/components/NewAgentDialog.svelte:227`).
- Background tasks skip cleanly when an adapter has no `generateText`
  (`src/main/memory-autosave.ts:246`, `src/main/commit-message.ts:51`).
- File restore on rewind is git-only (`src/main/checkpoints.ts`).

**Bugs that a second adapter will hit**
1. Worktree conversations lose their agent id: the create handler returns
   `{ id, branch }` without `agentType` (`src/main/ipc.ts:322`), while direct
   mode returns it (`:204`) and the type requires it
   (`src/shared/types.ts:696`). Until restart the status bar shows the
   default adapter's models, so a Claude model id could be sent to an
   OpenCode conversation.
2. `getControls()` for a conversation that isn't live returns the default
   adapter's controls (`src/main/agent-session.ts:1271`).
3. The MCP and Plugins settings always act on the default adapter
   (`src/main/preload.ts:200-212`).

**Claude assumptions in the renderer and main process**
- Tool blocks are picked by tool name, not category
  (`ToolCallBlock.svelte:26-33`). `DiffBlock`, `DiffView` and `FileOpBlock`
  read Claude's input fields (`file_path`, `old_string`, `new_string`).
- Summary view only shows tools named `Edit`, `Write`, `Bash`
  (`src/renderer/lib/message-view.ts:34`). The last-turn changes list only
  counts `Edit`/`Write` (`messages.svelte.ts:798`).
- Question prompts read `AskUserQuestion`'s `questions` array
  (`messages.svelte.ts:1505`).
- Approving an edit "always" or a plan forces `acceptEdits`
  (`messages.svelte.ts:1827-1838`).
- The memory system prompt always says a `grove-memory` MCP server exists
  (`src/main/memory.ts:243`), but that server is built with the Claude SDK
  (`adapters/memory-mcp-server.ts`).
- Rewind needs `resumeAtUuid`; nothing checks whether the adapter supports it
  (`agent-session.ts:1840`), so an adapter that ignores it would look rewound
  while the agent still remembers everything.
- Read-safe mode only knows Claude tool names (`src/main/read-only-tools.ts`).
- `/compact` and `/clear` are always offered (`PromptEditor.svelte:69`).
- Several capability flags are declared but never read: `permissions`,
  `permissionModes`, `resume`, `modelSwitching`, `thinking`,
  `imageAttachments`, `structuredOutput`, `sandbox`.

## Design

### Shape

```
src/main/adapters/
  acp/
    acp-adapter.ts       # AcpAdapter implements AgentAdapter
    acp-events.ts        # ACP session/update -> AgentEvent (pure, unit-tested)
    acp-permissions.ts   # request_permission <-> Grove PermissionHandler + modes
    profiles.ts          # HarnessProfile type + registry of profiles
    opencode.ts          # the OpenCode profile
  openrouter.ts          # model list, key check, generateText (plain fetch)
```

`AcpAdapter` is generic. Everything harness-specific sits in a profile:

```ts
interface HarnessProfile {
  id: string;                     // adapter id, e.g. 'opencode'
  displayName: string;            // e.g. 'OpenCode'
  command: string;                // looked up on PATH, e.g. 'opencode'
  args: string[];                 // e.g. ['acp']
  installInstructions: string;
  /** Env for one conversation's process: key, model, permission config. */
  buildEnv(opts: { model: string; apiKey: string; cwd: string }): Record<string, string>;
  /** Grove model id (OpenRouter slug) -> the harness's own id. */
  modelId(slug: string): string;  // OpenCode: `openrouter/${slug}`
}
```

One `AcpAdapter` instance per profile is registered in
`src/main/adapters/index.ts`. Claude stays first, so it stays the default.

### Process lifecycle (Windows)

- One agent process per conversation, spawned in the worktree `cwd`, stdio
  piped into `ClientSideConnection` from the SDK.
- Resolve the real `.exe` with `where.exe`. If only a `.cmd` npm shim is found,
  run it through `cmd.exe /d /s /c` **(verify quoting)**.
- `processId()` returns the child pid, so the existing process-tree kill on
  close (`src/main/process-tree.ts`) covers it.
- Handshake: `initialize` with Grove's client info, then `session/new`
  (or `session/load` / `session/resume` for a resumed conversation).
- Client capabilities: `fs` and `terminal` **off** in v1. The harness reads,
  writes and runs commands itself; Grove only watches and approves. This keeps
  the client small and matches how the Claude adapter works.

### ACP updates to Grove events

`acp-events.ts` is a pure mapper so it can be tested with recorded traffic.

| ACP (`session/update` unless noted) | Grove `AgentEvent` |
|---|---|
| `session/new` response | `system_init` (session id, model) |
| `agent_message_chunk` | `partial_text`, then `assistant_text` when the turn's message ends |
| `agent_thought_chunk` | `partial_thinking` / `thinking` |
| `tool_call` | `assistant_tool_use` with `toolCategory` from `kind` |
| `tool_call_update` (completed / failed) | `tool_result` (`isError` on failed) |
| `plan` | new `todo_list` event (see "Agent to-do lists" below) |
| `usage_update` (unstable) | `usage` |
| `current_mode_update` | `mode_sync` |
| `config_option_update` | `controls_sync` |
| `session/request_permission` (request) | `permission_request` via `onPermissionRequest` |
| `session/prompt` response `stopReason` | `result` (`cancelled` is not an error) |
| process exit | `process_exit` |

`uuid` on assistant events: ACP has no message ids, so the adapter makes
them. They are only used for rewind, which ACP adapters won't offer in v1.

ACP `kind` to `ToolCategory`:

| ACP kind | ToolCategory |
|---|---|
| `edit`, `delete`, `move` | `edit` |
| `read`, `search` | `read` |
| `execute` | `bash` |
| `fetch` | `web_fetch` |
| `think`, `switch_mode`, `other` | `other` |

### Tool display without Claude field names

Add one optional, neutral field to `assistant_tool_use` and
`permission_request`:

```ts
type ToolView =
  | { kind: 'diff'; path: string; oldText: string | null; newText: string }
  | { kind: 'command'; command: string }
  | { kind: 'files'; paths: string[] }
  | { kind: 'text'; title: string };
```

- The ACP adapter fills it from `content` (`type: "diff"` gives `path`,
  `oldText`, `newText`), `locations`, and `title`.
- The Claude adapter fills it from its own inputs, so both go through the
  same path.
- `ToolCallBlock` picks the block by `toolView.kind`, then `toolCategory`,
  and only then by Claude tool name (kept as a fallback for old saved history).
- Summary view, the last-turn changes list and the git refresh switch from
  tool names to categories.

### Agent to-do lists

ACP's `plan` update is the agent's live to-do list: entries with text, a
priority (`high` / `medium` / `low`) and a status (`pending` /
`in_progress` / `completed`). Each update sends the full list and the client
replaces what it showed. It needs no approval.

It is **not** Claude's plan mode (the approve-a-plan step handled by
`isPlanExecution` / `planText` in `PermissionBlock.svelte`). It is the same
idea as Claude Code's `TodoWrite` tool. Grove has no to-do display today:
nothing in `src` handles `TodoWrite`, so Claude's lists show as a generic
tool block.

Proposal: add a neutral `todo_list` event and one checklist block in the
activity stream, where each update replaces the last one. The ACP adapter
emits it from `plan`; the Claude adapter emits it from `TodoWrite`. A pinned
panel can come later. The unstable `plan_update` / `plan_removed` updates
(plans with ids) are ignored until they are stable.

### Permissions and modes

- The OpenCode profile writes a config that sets edit, bash and web fetch to
  `ask`, so every risky call reaches Grove **(verify OpenCode's permission
  keys and defaults)**.
- Grove answers requests itself, which removes the need for ACP-level
  auto-approve [14]:

| Grove mode | ACP adapter behaviour |
|---|---|
| `default` | Every request goes to the user. |
| `acceptEdits` | Auto-allow `edit`/`delete`/`move` kinds, ask for the rest. |
| `readSafe` | Auto-allow `read`/`search`, ask for the rest. |
| `plan` | Only if the agent advertises a plan mode; switch with `session/set_mode`. Hidden otherwise. |
| `auto` | Not offered. |

- Grove's answer maps to the offered `PermissionOption`: allow → `allow_once`,
  allow always → `allow_always` (and Grove's own always-allow list), deny →
  `reject_once`.
- The renderer's forced `acceptEdits` (`messages.svelte.ts:1827`) must first
  check that the conversation's controls offer it.

### Models and controls

- `getModels()` returns a short curated list first, with
  `deepseek/deepseek-v4.1-flash` as the default. The rest come from
  OpenRouter's model list, filtered to models that support tools, and are
  cached in `app-state.json` like Claude's `modelCatalogs` **(verify the
  exact list endpoint and filter)**.
- Grove stores the plain OpenRouter slug. The profile turns it into the
  harness id (`openrouter/deepseek/deepseek-v4.1-flash` for OpenCode).
- The model is set per process through `OPENCODE_CONFIG_CONTENT`. If
  `session/set_config_option` for the model works on the installed version,
  use it for live switching. If not, a model switch restarts the process and
  reloads the session (`capabilities.modelSwitching` reflects which).
- Controls come from ACP `configOptions` when the agent sends them
  (`model`, `mode`, `thought_level` categories map onto `ControlDescriptor`),
  plus the Grove permission-mode control above.

### Credentials

- `apiKey: { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter API key',
  helpUrl: 'https://openrouter.ai/keys' }`. It uses the existing encrypted
  store (`src/main/credentials.ts`); no new UI.
- The key goes into the child's env only. The profile's config points
  OpenCode at it **(verify `{env:...}` substitution or plain env pickup)**.
- `checkPrerequisites()`: harness found on PATH, `--version` works, and a key
  is saved. A cheap key check against OpenRouter is optional.

### Memory tools

The current memory server is in-process and Claude-SDK-only. For ACP:

- Run a small MCP server in the main process over HTTP on `127.0.0.1`, random
  port, random bearer token per app run. Pass it in `session/new`
  `mcpServers` as `type: "http"` with an `Authorization` header, when the
  agent advertises HTTP MCP support. Stdio fallback if it doesn't.
- The main process stays the only writer of the memory folder.
- Add a capability flag (for example `memoryTools`) and only add the memory
  part of the system prompt (`src/main/memory.ts:243`) when it is true.
- Add `@modelcontextprotocol/sdk` as a direct dependency. It is already in the
  lockfile as a transitive one.

### Background tasks

`generateText` calls OpenRouter's chat completions API with `fetch`, the
saved key and `backgroundModel` (default: the same Flash model). No agent
process is needed for commit messages or memory notes. This means the
conversation's content goes to the same provider the user picked, which keeps
the rule in `DESIGN.md` ("Background tasks").

### Resume and rewind

- Resume: use `session/load` or `session/resume` when the agent advertises
  them; set `capabilities.resume` from the handshake.
- Conversation rewind: not in ACP. Add a capability flag
  (`conversationRewind`) and hide "rewind conversation" when false. File-only
  restore still works because it is git-based.

### Capability flags the app should start reading

`resume`, `modelSwitching`, `permissionModes`, `imageAttachments` (ACP
advertises image prompt support), plus the new `memoryTools` and
`conversationRewind`. Slash commands `/compact` and `/clear` should come from
the adapter (ACP sends `available_commands_update`) instead of a fixed list.

## Phases

**Phase 0: spike (1 to 2 days).** A throwaway script, not app code. Spawn
`opencode acp` on Windows with an OpenRouter key and record every JSON-RPC
message to a fixture file. Answer:
- Does `session/set_config_option` for the model work on 1.18.x?
- Which `modes`, `configOptions` and `agentCapabilities` (load, resume, MCP
  HTTP, images) does it advertise?
- Does the `ask` permission config make every edit and command reach
  `request_permission`?
- Does `OPENCODE_CONFIG_CONTENT` with the key reference work, and does it
  leave the user's own OpenCode config and `auth.json` alone?
- What do diff, command and plan updates look like in practice?
- How does it behave when the key is wrong or out of credit?

**Phase 1: multi-adapter fixes (independent value).** Fix the three bugs
above, gate the memory prompt and rewind on capabilities, stop forcing
unsupported modes. Tests for each.

**Phase 2: neutral tool display.** Add `ToolView`, fill it in the Claude
adapter, switch the renderer and main-process checks from names to
`toolView` / `toolCategory`. Add the `todo_list` event and checklist block
(Claude's `TodoWrite` gets it too). Apart from that block, Claude
conversations must look the same before and after.

**Phase 3: ACP adapter + OpenCode profile + OpenRouter.** Adapter, event
mapper tests driven by the Phase 0 fixtures, permissions, models, key,
prerequisites. Help page and `DESIGN.md` section. Ships behind a setting until
it has been used for real work.

**Phase 4: memory server over HTTP and `generateText`.**

**Phase 5: more profiles.** Each one gets its own mini-spike: how to set the
provider and model, what it advertises, how it asks for permission.
Candidates from the ACP registry [2]: Goose, Qwen Code, Gemini CLI, Kimi CLI.
Codex CLI through `codex-acp` needs a Responses-compatible provider [6].

## Testing

- `acp-events.ts` and `acp-permissions.ts` are pure and get unit tests from
  recorded fixtures.
- An in-process fake ACP agent (the SDK ships `AgentSideConnection` and
  examples) drives `AcpAdapter` end to end in Vitest, without a network.
- Renderer tests for `ToolCallBlock` with `toolView` and with old Claude-only
  history.
- One manual Windows check per release with a real key.

## Risks and open questions

- **Harness quality varies.** ACP makes the protocol common, not the
  behaviour. OpenCode's ACP mode has had real gaps [13][14]. Each profile needs
  its own test pass.
- **Model quality.** A cheap model inside a harness is a different product
  from Claude Code. We should say that plainly in the UI and not promise
  feature parity.
- **Question prompts.** ACP has no standard "ask the user" tool. In v1 an ACP
  agent's questions show as normal text. Is that acceptable?
- **To-do display.** Checklist block in the activity stream (proposed), a
  pinned panel, or drop `plan` updates in v1?
- **Provider scope.** OpenRouter only in v1. The profile design allows DeepSeek
  direct and local models later without changing the adapter.
- **Naming.** The picker would show "OpenCode". Check OpenCode's trademark or
  branding guidance before shipping **(verify)**.
- **Terms.** OpenRouter's and each model provider's terms apply to the user's
  own key; Grove never resells usage (same rule as `DESIGN.md`,
  "Authentication rules").

## Sources

1. [Agent Client Protocol: agents](https://agentclientprotocol.com/get-started/agents), [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan), and the `@agentclientprotocol/sdk` 1.5.1 type definitions (`npm view`, `dist/acp.d.ts`, `dist/schema/types.gen.d.ts`).
2. [Zed: The ACP Registry is live](https://zed.dev/blog/acp-registry); [ACP agents list](https://agentclientprotocol.com/get-started/agents).
3. [Datadog Security Labs: OpenCode RCE (GHSA-632h-h47v-g4x4)](https://securitylabs.datadoghq.com/articles/opencode-upgrade-remote-code-execution/); [SentinelOne: CVE-2026-22812](https://www.sentinelone.com/vulnerability-database/cve-2026-22812/).
4. [DeepSeek API docs: Using the Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api/).
5. [Claude Code docs: Other LLM gateways](https://code.claude.com/docs/en/llm-gateway).
6. [openai/codex discussion #7782: Deprecating chat/completions support](https://github.com/openai/codex/discussions/7782); [Codex CLI custom model providers guide](https://codex.danielvaughan.com/2026/04/23/codex-cli-custom-model-providers-configuration-guide/).
7. [SiliconANGLE: DeepSeek releases V4.1-Flash](https://siliconangle.com/2026/09/10/deepseek-releases-v4-1-flash-says-it-outperforms-flagship-v4-pro/).
8. [OpenRouter: DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash).
9. [DeepSeek API docs: V4.1-Flash announcement](https://api-docs.deepseek.com/news/news260910/).
10. [OpenCode docs: ACP support](https://opencode.ai/docs/acp/).
11. [OpenRouter docs: OpenCode integration](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration); [OpenCode docs: Providers](https://opencode.ai/docs/providers/).
12. [OpenCode docs: Config](https://opencode.ai/docs/config/).
13. [anomalyco/opencode #31750: ACP per-session model selection](https://github.com/anomalyco/opencode/issues/31750); [#14098: ACP session config options](https://github.com/anomalyco/opencode/issues/14098).
14. [anomalyco/opencode #47918: Expose per-session automatic approval through ACP](https://github.com/anomalyco/opencode/issues/47918).
