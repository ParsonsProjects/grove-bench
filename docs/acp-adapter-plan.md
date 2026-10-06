# Other agents: the ACP adapter

Grove Bench keeps its native Claude Code adapter and adds one adapter for every
agent that speaks the Agent Client Protocol (ACP). This page records the audit
that led here, what changed, what is left, and the names the UI now uses.

## Why ACP

ACP is an open JSON-RPC protocol between editors and coding agents. Version 1
is stable, and stdio is the transport agents should support
([transports](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/transports.mdx)).
One ACP client reaches many agents:

- Gemini CLI: `gemini --acp`
  ([acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md))
- GitHub Copilot CLI: `copilot --acp`
  ([changelog](https://github.com/github/copilot-cli/blob/main/changelog.md))
- Codex, through the separate `codex-acp` wrapper
  ([registry](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/get-started/registry.mdx))
- OpenCode: `opencode acp`, built in for open models such as DeepSeek through
  OpenRouter; its settings and why are in `docs/open-model-harnesses-plan.md`

The trade-off: ACP is the common ground, so Claude-only features (plan usage,
MCP server management, truncating rewind, per-model effort and thinking) stay
with the native Claude adapter. A native Codex adapter on the app-server
protocol is still in `TODO.md`.

## Audit and what changed

| # | Finding | Change |
|---|---|---|
| 1 | The UI, Read-safe mode and parts of main read Claude Code's tool names and input fields (`Edit`, `file_path`, `old_string`) | `src/shared/tool-view.ts`: a neutral `ToolView` (kind, path, edits or whole-file write, command, pattern, URL). Adapters attach it; events without one are read as Claude Code tools, so saved history keeps working. New `tool_update` event for calls an agent fills in later |
| 2 | 8 of 12 capability flags were never read | The session manager passes a sandbox, output format, resume id and images only to agents that declare them. New `rewind` flag: rewinding on an agent without it starts a new conversation and says so. The composer skips images an agent can't take |
| 3 | Grove's memory and Preview tools were in-process Claude SDK servers | `grove-tools.ts` defines them once; `grove-mcp-http.ts` serves them over MCP Streamable HTTP on 127.0.0.1 with a per-query bearer token and a loopback Host check. Agents that can't connect over HTTP start Grove's stdio bridge instead (below) |
| 4 | Permissions relied on a per-call callback | ACP has one: `session/request_permission`. The ACP adapter answers from deny/allow rules, always-allow, the conversation's mode, then the user |
| 5 | Smaller Claude paths | Skill folders are named by the adapter (`SkillDirs`); adapters declare the files Grove writes into worktrees (`generatedFiles`) |

Correction to the first audit: the Plugins tab showing only for the default
agent is deliberate (`SettingsPanel.svelte` comment, `TODO.md`), not a bug.

## How the ACP adapter works

Code: `src/main/adapters/acp/`.

- **Start**: spawns the agent, sends `initialize` with no file system or
  terminal capability (the agent works on the worktree itself), then
  `session/resume`, `session/load` (replay hidden) or `session/new` in the
  worktree.
- **Turns**: `session/prompt`; message, thought, tool call, plan and usage
  updates become Grove events. A plan shows as one tool call per turn.
- **Grove's instructions** (path rules, project memory, your additions) go
  ahead of the first prompt of each new session, since ACP has no system prompt.
- **Modes**: Grove applies Ask, Edit and Read-safe itself, on the agent's
  permission requests. An agent that edits or runs a command without sending
  one is out of their reach; the thread says so once (`warnIfUnasked`). The agent's own modes and select options (Gemini's
  YOLO, Plan) are separate controls, learned from the first session and kept
  for the next launch. Options can differ by model (OpenCode's effort
  levels do), so they are kept per model (`byModel`), with each model's own
  starting values, and Settings shows the default model's. A model no
  session has used yet gets the last options seen. Modes that skip asking show in red (`agentModeTone`).
  When the agent changes a control itself (`current_mode_update`,
  `config_option_update`), the adapter sends `agent_controls` and the session
  manager records it, so the badge follows.
- **Models**: from a config option in the `model` category, or Gemini's older
  `models` field with `session/set_model` (removed from the protocol, still
  used by Gemini CLI).
- **Grove's tools**: agents that declare `mcpCapabilities.http` get the
  address. Every other agent gets a stdio server to start, since stdio is
  the transport every ACP agent must support
  ([session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx)).
  That server is Grove's own executable in Electron's Node mode
  (`ELECTRON_RUN_AS_NODE=1`) running `mcp-stdio-bridge.js`, which forwards
  each message to the HTTP server with the conversation's token
  (`adapters/mcp-bridge/`). electron-builder unpacks the script from
  app.asar, and `scripts/smoke-deps.mjs` checks the packaged app runs it.
- **Your MCP servers**: ACP can't list or change the servers in an agent's
  own settings; a client can only hand servers over in `session/new`, `load`
  and `resume`. So Grove keeps one list for all ACP agents
  (`acp/mcp-servers.ts`, `acp-mcp-servers.json` in userData), edited in
  Settings → MCP servers under one "ACP agents" entry, for all projects or
  one. They go after Grove's own servers. A stdio command is looked up on
  PATH (PATHEXT on Windows), since the protocol asks for an absolute path.
  HTTP and SSE servers go only to agents whose `mcpCapabilities` say they
  can connect; the thread names the ones left out. Agents don't report on
  their servers, so Settings shows them "not checked" and the status bar
  lists only Grove's.
- **Sign-in**: done in the agent's own CLI, or with an API key saved in
  Grove. An `auth_required` error keeps the agent's own reason, says which
  command to run, and is remembered (`agentSignIn` in app state) so the next
  draft asks first. An agent with a CLI sign-in can be checked for real
  (`checkSignIn`: a throwaway session in an empty folder), which also
  learns the agent's models and options for Settings. When a key is
  saved and the agent offers the key's method (Gemini CLI's
  `gemini-api-key`), Grove calls `authenticate` with it and tries again.
- **Install**: Grove never installs anything. A missing agent shows its
  install command with a copy button: the ACP Registry's when it lists an
  npm or Python package for it, else the preset's.
- **Online lists** (`catalogs.ts`): the ACP Registry and models.dev, fetched
  at most once a day while Settings > Privacy allows it and kept in
  userData/catalogs. The registry gives install commands and the list
  under Other agents; models.dev gives each model's context size, so the
  context meter is right before the first reply.
- **Background tasks** (commit messages, branch names, memory notes) run as
  a one-off session with every tool request turned down.
- **Custom agents**: Settings → Agent → Other Agents (ACP): a name, command,
  arguments and environment variables (like the `command`, `args` and `env`
  of Zed's `agent_servers` entries). Read at launch.

## Not done yet

- Replying to a denied permission with a message: ACP's reject options carry
  no text, so the reply doesn't reach the agent.
- File system and terminal client capabilities (letting the agent read
  through Grove, or run commands in Grove's terminal).
- `session/close` and `session/list` (titles across restarts).
- Tested against a fake agent in `acp-adapter.test.ts`, not yet against real
  Gemini CLI or Copilot CLI on Windows. OpenCode has been run for real, on
  Linux with a fake OpenRouter (`scripts/acp-spike/`); a Windows run with a
  real key is still to come.

## Names

This branch first named single items in the UI (Trails for MCP servers,
Field guides for skills, Saplings for plugins, Nursery for the plugin
marketplace). Main's Settings redesign names Settings sections instead,
each with its plain name under it ("Tool shed" for MCP servers, "Seed
packets" for plugins; see `src/renderer/lib/settings-search.ts`), and keeps
the plain words everywhere else. The merge follows main, so the per-item
names are gone.
