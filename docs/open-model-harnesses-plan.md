# Open-Model Harnesses (ACP)

> **Status: Proposal.** Nothing here is implemented yet. Facts about outside
> projects were checked on 28 September 2026 and are linked in
> [Sources](#sources). The offline half of the Phase 0 spike is done (see
> [Spike findings](#spike-findings-phase-0a)); items still marked
> **(verify)** need the Windows run with a real key.

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
| Dedicated OpenCode SDK adapter | Later, maybe | Richer (session revert/unrevert, fork, provider lists, todos), MIT, but tied to one vendor. The SDK also ships a `v2` folder, so its API is still moving. Worth revisiting only if ACP's gaps (rewind) hurt. Its local HTTP server is not a reason against it: `opencode acp` opens the same server (see Spike findings), and OpenCode's earlier unauthenticated-server RCE, CVE-2026-22812, was fixed in 1.0.216 [3]. |
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
- **Reported ACP gaps.** Issues said a client couldn't pick the model per
  session [13] and asked for automatic approval through ACP [14]. On 1.18.33
  the first is fixed (live model switching works, see Spike findings) and the
  second doesn't matter, because Grove answers permission requests itself.

## Spike findings (Phase 0a)

`scripts/acp-spike/probe-offline.mjs` runs `opencode acp` 1.18.33 against a
local fake of OpenRouter's chat completions API, so each check runs without
a network or a key. It passes 40 of 40 checks; the trimmed recordings are in
`scripts/acp-spike/fixtures/`. Run on Linux; Windows is Phase 0b.

| Question | Answer | Effect on the design |
|---|---|---|
| What does it advertise? | `loadSession`, session `resume` / `fork` / `list` / `close`, HTTP and SSE MCP servers, image and embedded-context prompts. Config options `model`, `effort` (`thought_level`) and `mode` (`build`, `plan`). Slash commands `init`, `review`, `customize-opencode`. | Resume, images and memory tools are all possible. |
| Model per session? | Yes. `session/set_config_option` switches live (Flash to V4 Pro and back); an unknown id returns `-32602`. The model list has 392 OpenRouter models. | No restart for a model switch. Model list comes from ACP, not OpenRouter's API. |
| Effort per model? | Yes, it changes with the model: Flash offers low / high / max, V4 Pro offers high / xhigh. | Maps onto Grove's per-model controls. |
| Does the config reach it? | Yes. `OPENCODE_CONFIG_CONTENT` sets the model, and `{env:OPENROUTER_API_KEY}` puts the key in the `Authorization` header. | Key stays in the child's env only. |
| Permission prompts? | `permission: { edit: "ask", bash: "ask" }` makes write, edit and every command ask. Options are `once` / `always` / `reject`. A write's request carries a full diff (`oldText: ""`). "Always" holds for the rest of the session. | Permission UI can show real diffs. |
| What does rejecting do? | The tool call fails and **the turn ends**; the model isn't called again. | "Deny with a message" can't steer an ACP agent the way it steers Claude. |
| Plan mode? | `mode: plan` alone still lets edits through (they just ask). With `agent.plan.permission.edit: "deny"` the edit and write tools are removed from what the model sees. | The profile's config must set the plan-agent deny. |
| Stop during a prompt? | `session/cancel` plus answering the pending request `cancelled` gives `stopReason: "cancelled"`, and OpenCode closes the request to the provider. During a retry wait (below) it reports `end_turn` instead. | Maps to Grove's stop. Treat any stop result after a cancel as stopped. |
| Wrong key / out of credit? | A 401 or 402 fails `session/prompt` at once with `-32603` and OpenRouter's message (`"User not found."`, `"Insufficient credits. Add more using https://openrouter.ai/settings/credits"`). No retry. | Map 401 to "OpenRouter key rejected" and 402 to "OpenRouter credits used up", with the link. |
| Rate limit (429)? | Retried on its own, honouring `retry-after`: one 429 then success took 1.5 s. A 429 on every attempt gives up after 6 requests (5.5 s with `retry-after: 1`) with `"Rate limit exceeded"`. | Show the error; nothing to retry in Grove. |
| Error mid-stream? | OpenRouter reports a provider failure after the 200 as a final chunk with `finish_reason: "error"` [16]. OpenCode retries with a doubling wait (+1, +4, +8, +18, +35, +65 s) and fails with the provider's error after about **65 s**. Each retry re-sends the partial text under the **same `messageId`**, and **nothing tells the client it is retrying**. | The mapper replaces a message when its `messageId` starts streaming again, rather than appending. Grove shows "waiting for the provider" when a turn has been silent for a while, since Stop is the only way out sooner. |
| Tool call shape? | `tool_call` arrives with an empty `rawInput`; the input comes in the first `in_progress` update. Completed updates don't repeat `kind`. Edits finish with a `diff` (the changed snippet). | The mapper keeps per-call state and emits `assistant_tool_use` once the input is known. |
| To-do lists? | OpenCode sends **no** ACP `plan` update. To-dos are a `todowrite` tool call (`kind: "other"`, `rawInput.todos`). | The OpenCode profile maps `todowrite` to `todo_list`. |
| Usage? | `usage_update` gives tokens used, context size (1,048,576) and the session's running cost in USD. The prompt result also has token counts. | Grove can show cost, which it can't for Claude today. |
| Message ids? | Chunks carry `messageId`. | Use them as event `uuid`s. |
| Restart? | `session/load` in a new process replays the whole conversation; `session/resume` doesn't. `fork` copies the whole session and takes no message id. | Resume with `session/resume`, since Grove keeps its own history. No conversation rewind. |
| Memory tools? | An `http` MCP server with a bearer header in `session/new` works. The model sees `grove-memory_memory_read`; MCP calls don't ask permission. | Memory design confirmed. |
| Where does it write? | With `HOME` / `XDG_*` pointed at a temp folder: a SQLite database, a log, and, for git projects, its own snapshot git repo under `data/opencode/snapshot`. Nothing in the worktree. | Grove can give OpenCode a home under its own `userData`. |
| Extra traffic? | One title-generation request per new session (uses `small_model`). At start-up it fetches `models.opencode.ai` (falls back to a bundled list) and tries a background `npm install` of its plugin package. | Behind a firewall both fail quietly. Note in help. |
| **Local server** | `opencode acp` also opens an HTTP server on `127.0.0.1` (4096, or a random port if taken). **Without a password it serves the API key in plain text** (`GET /config`) and lets any local process create sessions. `OPENCODE_SERVER_PASSWORD` makes it return 401; basic auth `opencode:<password>` gets in. | Grove must set a random password for every process. |

## Where we are today

The adapter layer is ready for a second agent. The rest of the app is not
fully. From an audit of the code (re-checked after merging main; line numbers
at commit `8be60ca`):

**Already adapter-neutral**
- `AgentAdapter` / `AgentQueryHandle` in `src/main/adapters/types.ts`, with
  capability flags, `getControls(model)`, optional `apiKey`,
  `backgroundModel` and `generateText`.
- The registry, per-adapter settings, saved keys and default models
  (`DESIGN.md`, "Several agents"). The Draft pane that replaced the New
  Conversation dialog keeps an agent per draft (`agentId` in
  `src/renderer/stores/draft.svelte.ts`, `DraftAgentControl.svelte`).
- MCP settings pass the agent through (`mcpConfig*` in
  `src/main/preload.ts`), since main made MCP provider-neutral.
- Background tasks skip cleanly when an adapter has no `generateText`
  (`src/main/memory-autosave.ts:246`, `src/main/commit-message.ts:51`).
- File restore on rewind is git-only (`src/main/checkpoints.ts`).

**Bugs that a second adapter will hit**
1. Worktree conversations lose their agent id: the create handler returns
   `{ id, branch }` without `agentType` (`src/main/ipc.ts:368`), while direct
   mode returns it (`:244`) and the type requires it
   (`src/shared/types.ts:878`). The Draft pane stores the missing value
   (`src/renderer/stores/draft.svelte.ts:288`), so until restart the app
   treats the conversation as the default agent's, and a Claude model id
   could be sent to an OpenCode conversation.
2. `getControls()` for a conversation that isn't live returns the default
   adapter's controls (`src/main/agent-session.ts:1409`).
3. The Plugins settings still act on the default adapter (`plugin*` in
   `src/main/preload.ts` take no agent). Minor, since only Claude has
   plugins.

**Claude assumptions in the renderer and main process**
- Tool blocks are picked by tool name, not category
  (`ToolCallBlock.svelte:26-33`). `DiffBlock`, `DiffView` and `FileOpBlock`
  read Claude's input fields (`file_path`, `old_string`, `new_string`).
- Summary view only shows tools named `Edit`, `Write`, `Bash`
  (`src/renderer/lib/message-view.ts:34`). The last-turn changes list only
  counts `Edit`/`Write` (`messages.svelte.ts:831`).
- Question prompts read `AskUserQuestion`'s `questions` array
  (`messages.svelte.ts:1558`).
- Approving an edit "always" or a plan forces `acceptEdits`
  (`messages.svelte.ts:1915`, `:1923`).
- The memory system prompt always says a `grove-memory` MCP server exists
  (`src/main/memory.ts:244`), but that server is built with the Claude SDK
  (`adapters/memory-mcp-server.ts`). The new Preview tools are built the same
  way (`adapters/preview-mcp-server.ts`), so they are Claude-only too.
- Rewind needs `resumeAtUuid`; nothing checks whether the adapter supports it
  (`agent-session.ts:2125`), so an adapter that ignores it would look rewound
  while the agent still remembers everything.
- Read-safe mode only knows Claude tool names (`src/main/read-only-tools.ts`).
- `/compact` and `/clear` are always offered (`PromptEditor.svelte:87`).
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
  openrouter.ts          # key check, generateText (plain fetch)
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
- Resolve a real `.exe`. Node refuses to spawn `.cmd` / `.bat` files without
  a shell since the CVE-2024-27980 fix [15], so when `where.exe` finds only the
  npm shim, use the `opencode.exe` that the `opencode-ai` package ships in
  `node_modules/opencode-ai/bin/` next to it (`resolveOpencode()` in
  `scripts/acp-spike/lib.mjs`) **(verify on Windows)**.
- Set a random `OPENCODE_SERVER_PASSWORD` for every process. Without it the
  local server hands out the API key (see Spike findings).
- Point `HOME`, `APPDATA`, `LOCALAPPDATA` and `XDG_*` at a folder under
  Grove's `userData`, so OpenCode's database, logs and snapshots stay out of
  the user's own OpenCode setup **(verify on Windows)**. Open question: should
  a user's own OpenCode config (plugins, MCP servers, `AGENTS.md`) apply
  instead? Isolated is safer and predictable, so it is the default.
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
| `tool_call` + first `tool_call_update` with input | `assistant_tool_use` with `toolCategory` from `kind` (input arrives in the update) |
| `tool_call_update` (completed / failed) | `tool_result` (`isError` on failed) |
| `plan` | new `todo_list` event (see "Agent to-do lists" below). OpenCode sends a `todowrite` tool call instead, which its profile maps to the same event. |
| `usage_update` (unstable) | `usage`, plus context window and running cost |
| `current_mode_update` | `mode_sync` |
| `config_option_update` | `controls_sync` |
| `session/request_permission` (request) | `permission_request` via `onPermissionRequest` |
| `session/prompt` response `stopReason` | `result` (`cancelled` is not an error) |
| process exit | `process_exit` |

`uuid` on assistant events: OpenCode sends a `messageId` on each chunk, so
the adapter uses it and only makes one up when an agent sends none. Grove
only needs them for rewind, which ACP adapters won't offer in v1.

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
emits it from `plan`; the Claude adapter emits it from `TodoWrite`. OpenCode
never sends `plan` (spike): its to-dos are a `todowrite` tool call, so the
OpenCode profile maps that tool to `todo_list`. A pinned
panel can come later. The unstable `plan_update` / `plan_removed` updates
(plans with ids) are ignored until they are stable.

### Permissions and modes

- The OpenCode profile writes a config that sets edit, bash and web fetch to
  `ask`, so every risky call reaches Grove, and denies edits to the plan
  agent (`agent.plan.permission.edit: "deny"`). Both confirmed in the spike.
- Grove answers requests itself, which removes the need for ACP-level
  auto-approve [14]:

| Grove mode | ACP adapter behaviour |
|---|---|
| `default` | Every request goes to the user. |
| `acceptEdits` | Auto-allow `edit`/`delete`/`move` kinds, ask for the rest. |
| `readSafe` | Auto-allow `read`/`search`, ask for the rest. |
| `plan` | Only if the agent advertises a plan mode; switch with the `mode` config option (OpenCode) or `session/set_mode`. Hidden otherwise. |
| `auto` | Not offered. |

- Grove's answer maps to the offered `PermissionOption`: allow → `allow_once`,
  allow always → `allow_always` (and Grove's own always-allow list), deny →
  `reject_once`. Deny ends the turn in OpenCode, so the prompt should say so.
- The renderer's forced `acceptEdits` (`messages.svelte.ts:1827`) must first
  check that the conversation's controls offer it.

### Models and controls

- `getModels()` returns a short curated list first, with
  `deepseek/deepseek-v4.1-flash` as the default. The rest come from the
  `model` config option the agent sends at `session/new` (392 OpenRouter
  models in the spike), cached in `app-state.json` like Claude's
  `modelCatalogs` so the New Conversation dialog has a list before any
  session starts. No call to OpenRouter's own model API is needed.
- Grove stores the plain OpenRouter slug. The profile turns it into the
  harness id (`openrouter/deepseek/deepseek-v4.1-flash` for OpenCode).
- The starting model is set through `OPENCODE_CONFIG_CONTENT`; switching
  mid-conversation uses `session/set_config_option` (works on 1.18.33), so
  `capabilities.modelSwitching` is true.
- Controls come from ACP `configOptions` when the agent sends them
  (`model`, `mode`, `thought_level` categories map onto `ControlDescriptor`),
  plus the Grove permission-mode control above.

### Credentials

- `apiKey: { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter API key',
  helpUrl: 'https://openrouter.ai/keys' }`. It uses the existing encrypted
  store (`src/main/credentials.ts`); no new UI.
- The key goes into the child's env only, and the profile's config reads it
  with `{env:OPENROUTER_API_KEY}` (confirmed in the spike).
- `checkPrerequisites()`: harness found on PATH, `--version` works, and a key
  is saved. A cheap key check against OpenRouter is optional.

### Memory tools

The current memory server is in-process and Claude-SDK-only, and so is the
Preview server that main added. For ACP (the same approach serves both):

- Run a small MCP server in the main process over HTTP on `127.0.0.1`, random
  port, random bearer token per app run. Pass it in `session/new`
  `mcpServers` as `type: "http"` with an `Authorization` header, when the
  agent advertises HTTP MCP support. Stdio fallback if it doesn't. The spike
  confirmed this with OpenCode; its tools appear as
  `grove-memory_memory_read` and so on, and don't ask permission.
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

- Resume: prefer `session/resume`, which picks the conversation up without
  replaying it; Grove already has the history. `session/load` replays every
  message, so it is only a fallback. Set `capabilities.resume` from the
  handshake.
- Conversation rewind: not in ACP (`fork` copies the whole session and takes
  no message id). Add a capability flag
  (`conversationRewind`) and hide "rewind conversation" when false. File-only
  restore still works because it is git-based.

### Capability flags the app should start reading

`resume`, `modelSwitching`, `permissionModes`, `imageAttachments` (ACP
advertises image prompt support), plus the new `memoryTools` and
`conversationRewind`. Slash commands `/compact` and `/clear` should come from
the adapter (ACP sends `available_commands_update`) instead of a fixed list.

## Phases

**Phase 0a: offline spike (done).** `scripts/acp-spike/probe-offline.mjs`,
results in [Spike findings](#spike-findings-phase-0a).

**Phase 0b: Windows run with a real key.** `scripts/acp-spike/probe-real.mjs`
runs one small task on DeepSeek V4.1 Flash in a temp folder (well under
$0.01), presses Stop during a second task, and records it to
`fixtures/real-win32.jsonl`. It snapshots the user's own OpenCode folders
before and after, and fails if anything in them changed. Answers:
- Does the real model use the tools well: to-do list, edits, running a test?
- Which shell runs commands on Windows, and what do paths look like in
  `locations` and diffs?
- Do the `XDG_*` / `APPDATA` overrides keep OpenCode out of the user's own
  setup on Windows?
- Does resolving `opencode.exe` beside the npm shim work?
- Time to first update, turn time and cost per turn.
- Does Stop end a real turn, and does the same session work afterwards?
- What a wrong key looks like against the real OpenRouter.

**Phase 1: multi-adapter fixes.** Fix bugs 1 and 2 above, gate the memory
prompt and rewind on capabilities, stop forcing unsupported modes. Tests for
each. No visible change while Claude is the only agent; it is groundwork for
any second adapter.

**Phase 2: neutral tool display.** Add `ToolView`, fill it in the Claude
adapter, switch the renderer and main-process checks from names to
`toolView` / `toolCategory`. Add the `todo_list` event and checklist block
(Claude's `TodoWrite` gets it too). Apart from that block, Claude
conversations must look the same before and after.

**Phase 3: ACP adapter + OpenCode profile + OpenRouter.** Adapter, event
mapper tests driven by the Phase 0 fixtures, permissions, models, key,
prerequisites. Help page and `DESIGN.md` section. Ships behind a setting until
it has been used for real work.

**Phase 4: memory and Preview servers over HTTP, and `generateText`.**

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
  its own test pass; `probe-offline.mjs` is that pass for OpenCode and should
  be re-run before bumping its version.
- **OpenCode's local server.** It holds the API key and can run commands.
  The random password closes it to other processes, but it is still one more
  listening port per conversation. Worth an upstream request for a way to turn
  it off in ACP mode.
- **Disk use.** OpenCode keeps a snapshot git repo per project in its data
  folder. Grove should clean up with the project, or at least document it.
- **Silent retries.** When the provider fails mid-stream, a turn can sit for
  about a minute with no signal before it errors (see Spike findings).
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
15. [Node.js April 2024 security releases (CVE-2024-27980)](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2).
16. [OpenRouter docs: API credit and rate limits (402 and 429)](https://openrouter.ai/docs/api_reference/limits).
