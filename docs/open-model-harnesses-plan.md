# Open models through OpenCode

> **Status: alpha, waiting on a Windows run with a real key.** OpenCode is a
> built-in agent on top of main's ACP adapter (`docs/acp-adapter-plan.md`),
> with an optional OpenRouter key that starts conversations on DeepSeek V4.1
> Flash. It is an alternative to Claude Code, which stays the default, and is
> off until turned on in Settings. What it does and why is in [What this branch changed](#what-this-branch-changed);
> what is still open is in [Left to do](#left-to-do). Facts about outside
> projects were checked between 28 September and 2 October 2026 and are
> linked in [Sources](#sources).

## Goals

1. Run a Grove conversation on a non-Anthropic model, starting with
   DeepSeek V4.1 Flash.
2. Do it through an open-source agent harness, not by pointing Claude Code at
   another model.
3. Add the integration once, so more harnesses cost little each.

## Decisions

| Question | Decision |
|---|---|
| Integration route | Main's generic **Agent Client Protocol (ACP)** adapter (`src/main/adapters/acp/`). Grove is the ACP client, the harness is the ACP agent. |
| Harness | **OpenCode** (`opencode acp`), as a built-in preset next to Gemini CLI and Copilot CLI. |
| Model provider | **OpenRouter**, with the user's own key saved in Grove. Optional: OpenCode also uses whatever providers the user signed in to with `opencode auth login`. |
| Release | **Alpha.** Claude Code stays the default agent; OpenCode is an alternative picked per conversation. It is hidden from the agent picker until the user ticks **Enable OpenCode** (Settings > Agents, `enabledAlphaAgents`), and marked Alpha in Settings and the picker. Turning it off hides it for new conversations only, so existing ones still resume. Any agent can be made alpha with `stage: 'alpha'` on its definition. |
| Getting the harness | **Found on PATH**, with install steps when missing, as for the other ACP agents. No bundling. npm's `.cmd` shim for `opencode` starts fine on Windows [15]. |
| The user's own OpenCode setup | **Kept.** Grove merges its settings over the user's (`OPENCODE_CONFIG_CONTENT`) rather than giving OpenCode a separate home, so the user's sign-ins, plugins and MCP servers still apply. |

## Why ACP, and why not the other routes

| Route | Verdict | Reason |
|---|---|---|
| Generic ACP adapter | **Chosen** | ACP is a JSON-RPC 2.0 standard between editors and coding agents [1]. The ACP registry lists about 50 agents, including OpenCode, Goose, Qwen Code, Gemini CLI, Kimi CLI and Codex CLI [2]. One adapter, many harnesses. Main built it (#140) while this plan was being written. |
| Dedicated OpenCode SDK adapter | Not needed | Richer (session revert, provider lists, todos), MIT, but tied to one vendor, and its SDK ships a `v2` folder, so its API is still moving. ACP covers what Grove needs except rewind. |
| Claude adapter pointed at another endpoint | Rejected | DeepSeek offers an Anthropic-format endpoint that Claude Code can use [4], but Anthropic's docs say it "doesn't support routing Claude Code to non-Claude models through any gateway" [5]. Claude Code is also not open source, so it misses goal 2. |
| Codex app-server | Rejected for this goal | Codex removed the Chat Completions wire API in February 2026; only `wire_api = "responses"` is accepted [6]. DeepSeek's own API is Chat Completions and Anthropic format [4], so it needs a gateway. A native Codex adapter stays on `TODO.md`. |

## The model: DeepSeek V4.1 Flash on OpenRouter

- Released 10 September 2026 [7]. On OpenRouter the slug is
  `deepseek/deepseek-v4.1-flash`, with a 1,048,576-token context, text and
  image input, and tool calling on 25 of 26 serving providers [8].
- Price on OpenRouter when checked: about $0.03 per million input tokens and
  $0.60 per million output tokens [8]. Prices change.
- DeepSeek retired V4-Flash; its old id now routes to V4.1 Flash [9]. The
  default is one constant, `OPENCODE_DEFAULT_MODEL` in
  `src/main/adapters/acp/opencode.ts`.
- OpenCode's catalog lists 50 providers serving V4.1 Flash, including
  DeepSeek itself, DeepInfra, Together and Fireworks (from the catalog
  bundled with OpenCode 1.18.33, which comes from models.dev). Any of them
  works through `opencode auth login`; only OpenRouter has a key field in
  Grove.

## The harness: OpenCode

- MIT licence, version 1.18.33, with `opencode-windows-x64` and
  `opencode-windows-arm64` binaries (`npm view opencode-ai`).
- `opencode acp` runs OpenCode as an ACP agent over stdio [10].
- OpenRouter is a built-in provider; model ids are written
  `openrouter/<slug>` [11].
- Config can be passed per process in `OPENCODE_CONFIG_CONTENT` (inline
  JSON), which takes precedence over the user's config files [12].
- Reported ACP gaps [13][14] are gone or don't matter on 1.18.33: the model
  can be switched per session, and Grove answers permission requests itself.

## What this branch changed

Main's ACP adapter was the base. Testing it against real OpenCode found the
problems below; each is a separate commit with tests.

| Change | Why |
|---|---|
| `initialize` sends `clientInfo.version` | The protocol's `Implementation` type requires it [1], and OpenCode rejects the request without it (`-32602 Invalid params`), so OpenCode couldn't start at all. The fake agent in the adapter tests now validates `initialize` as strictly as OpenCode. |
| A new worktree conversation names its agent | The create handler returned no `agentType` for new and existing-branch worktrees, so a Gemini CLI or Copilot CLI conversation showed Claude Code's models and controls until restart. |
| A sleeping or closed conversation shows its own agent's controls | `getControls` fell back to the default agent for any conversation that wasn't running. It now reads the agent and model from the manifest. |
| Warning when an agent acts without asking | Grove's modes and tool rules act on permission requests. An agent that doesn't send them (OpenCode's defaults, a YOLO mode) edits and runs commands while Grove shows Ask, and deny rules never fire. The thread now says so once, naming the mode or the rule it went past. |
| OpenCode preset (`adapters/acp/opencode.ts`, `presets.ts`) | Runs `opencode acp` with four settings merged over the user's: edits, commands and fetches **ask** (OpenCode's default is to just do them), set at the top level and on the `build` and `plan` agents, after the user's own rules; **no subagents** (`task: deny`); the plan agent **can't edit** (OpenCode's plan mode otherwise lets edits through after a prompt); and a random **`OPENCODE_SERVER_PASSWORD`** per process (the local API otherwise lets any program on the computer use it and read saved provider keys). An OpenRouter key saved in Grove is checked against `GET /api/v1/key` [17], passed in `OPENROUTER_API_KEY`, and makes new conversations start on DeepSeek V4.1 Flash. |

Checked against real OpenCode 1.18.33 with a fake OpenRouter, through the
real preset and adapter: it starts on DeepSeek V4.1 Flash with the saved key,
asks before the edit and the command, a `shell(rm *)` deny rule refuses an
`rm` without asking the user, no "without asking" warning appears, the local
server answers 401 without the password, and plan mode leaves the file alone.

## Spike findings

`scripts/acp-spike/probe-offline.mjs` runs `opencode acp` 1.18.33 against a
local fake of OpenRouter's chat completions API, so each check runs without
a network or a key. It passes 44 of 44 checks; the trimmed recordings are in
`scripts/acp-spike/fixtures/`. Re-run it before bumping the OpenCode version
the spike pins.

| Question | Answer | In Grove now |
|---|---|---|
| What does it advertise? | `loadSession`, session `resume` / `fork` / `list` / `close`, HTTP and SSE MCP servers, image and embedded-context prompts. Config options `model`, `effort` (`thought_level`) and `mode` (`build`, `plan`). Slash commands `init`, `review`, `customize-opencode`. | All used by the adapter. |
| Model per session? | Yes. `session/set_config_option` switches live; an unknown id returns `-32602`. | Model picker works; effort options follow the model. |
| Effort per model? | Yes: Flash offers low / high / max, V4 Pro offers high / xhigh. | Shown as a control. |
| Permission prompts? | With `ask`, write, edit and every command ask; options `once` / `always` / `reject`; a write's request carries a full diff. **By default nothing asks.** | Preset sets `ask`; warning for agents that don't. |
| A project's own `opencode.json`? | Its agent-level permissions win over the top level, so `agent.build.permission.edit: "allow"` undoes a top-level `ask`. When several rules match, the last one wins, and a key merged from two configs keeps the project's position. With Grove's rules on the `build` and `plan` agents, a project that allows everything still gets asked. **One gap:** a project `agent.build.permission` of `{ "bash": "allow", "*": "allow" }` still runs commands without asking. | Preset sets the agent-level rules; the "without asking" warning covers the gap. |
| Subagents? | The `task` tool runs a subagent in a child session. Its permission requests are **not sent over ACP**, so a subagent that asks hangs the turn. `task: "deny"` removes the tool, even against a project's `allow`. | Preset denies `task`. |
| What does rejecting do? | The tool call fails and **the turn ends**. | Known; a deny can't carry a message to the agent. |
| Plan mode? | `mode: plan` alone still lets edits through. With `agent.plan.permission.edit: "deny"` the edit tools are removed. | Preset sets the deny. |
| Stop during a prompt? | `session/cancel` gives `stopReason: "cancelled"` and closes the request to the provider. During a retry wait it reports `end_turn`. | The session manager shows any stop the user asked for as a clean stop, whatever the agent reports. |
| Wrong key / out of credit? | A 401 or 402 fails the prompt at once with OpenRouter's message. No retry. | Shown as the turn's error. |
| Rate limit (429)? | Retried, honouring `retry-after`; gives up after 6 requests. | Shown as the turn's error. |
| Error mid-stream? | OpenRouter reports it as a final chunk with `finish_reason: "error"` [16]. OpenCode retries with a doubling wait and fails after about **65 s**, with **no signal to the client**, and streams the retry into the **same message** after the failed text. | Not fixable in Grove; see Left to do. |
| Tool call shape? | `tool_call` arrives with an empty `rawInput`; the input comes in the first `in_progress` update. | The adapter's `tool_update` fills it in. |
| To-do lists? | No ACP `plan` update. To-dos are a `todowrite` tool call. | Shown as a plain tool call. |
| Usage? | `usage_update` gives tokens used, context size and running cost in USD. | Tokens and context size shown; cost not yet. |
| Restart? | `session/load` replays the conversation; `session/resume` doesn't. `fork` takes no message id. | Adapter prefers `session/resume`; no conversation rewind. |
| Memory tools? | An `http` MCP server with a bearer header works; the model sees `grove-memory_memory_read`; MCP calls don't ask. | Served by main's `grove-mcp-http.ts`. |
| Where does it write? | Its data folder: a SQLite database, a log, and for git projects its own snapshot repo. Nothing in the worktree. | The user's normal OpenCode data folder. |
| Extra traffic? | One title request per new session (uses `small_model`). At start-up it fetches `models.opencode.ai` (falls back to a bundled list) and tries a background `npm install` of its plugin package. | With a saved key, `small_model` is Flash too, so titles cost little. |
| **Local server** | `opencode acp` opens an HTTP server on `127.0.0.1` (4096, or a free port). **Without a password** it serves saved provider keys (`/config/providers`, `/provider`, and `/config` when the key is in the config) and lets any local process create sessions. `OPENCODE_SERVER_PASSWORD` makes it return 401. | Preset sets a random password per process. |

## Left to do

- **Windows run with a real key (Phase 0b).** `scripts/acp-spike/probe-real.mjs`
  runs a small task on DeepSeek V4.1 Flash in a temp folder (well under
  $0.01), presses Stop during a second task, tries a wrong key, and fails if
  the user's own OpenCode folders change. It answers what Linux and a fake
  can't: the real model's tool use, the Windows shell and paths, the npm
  shim, time and cost. Steps in `scripts/acp-spike/README.md`.
- **Retried replies (upstream).** OpenCode streams a retried reply into the
  same message as the failed attempt, with the same `messageId` and no
  marker, so Grove shows "First attempt, partialSecond attempt, full
  answer." A pause is the only signal, and a healthy reply can pause too, so
  Grove can't undo it without risking real text. It needs an OpenCode issue
  (the probe's "retried reply" check is the reproduction, and flips when it
  is fixed).
- **Silent retries.** The same retries leave a turn quiet for up to about a
  minute. A "waiting for the provider" hint after a long silence would help
  every agent, but long-running commands are silent too, so it needs care.
- **To-do lists.** OpenCode's `todowrite` and Claude Code's `TodoWrite` both
  show as plain tool calls. A shared `todo_list` event and checklist block
  would serve both; the ACP adapter would map OpenCode's tool to it.
- **Cost.** OpenCode reports each session's running cost; Grove doesn't show
  it yet.
- **A long model list.** OpenCode lists every model of every provider it can
  use (598 in testing), so the picker is long. Grouping or search would help.
- **Custom agents can't set environment variables.** The adapter takes an
  `env` per agent, but Settings > Agent > Other Agents doesn't offer it, so a
  custom agent that needs a secret or a setting (as OpenCode did before the
  preset) has no way to get one.

## Sources

1. [Agent Client Protocol: agents](https://agentclientprotocol.com/get-started/agents), [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan), and the `@agentclientprotocol/sdk` 1.5.1 type definitions (`dist/schema/types.gen.d.ts`, `Implementation`).
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
15. [Node.js April 2024 security releases (CVE-2024-27980)](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2). Main spawns agents with execa, which uses cross-spawn, so npm `.cmd` shims work.
16. [OpenRouter docs: API credit and rate limits (402 and 429)](https://openrouter.ai/docs/api_reference/limits).
17. [OpenRouter API reference: Get current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).
