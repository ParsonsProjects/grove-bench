# Settings

Open Settings from the gear icon in the sidebar bottom controls. Settings are organized into tabs.

## Permissions

Control how the agent handles actions that need approval:

- **Default Permission Mode** — The mode new conversations start in. See [Status bar](status-bar.md#mode) for what each mode allows:
  - **Default**: asks before edits and non-trivial commands
  - **Accept Edits**
  - **Plan (read-only)**
  - **Auto (Claude classifier approves actions)**: Claude's classifier approves or blocks each action
  - **Bypass Permissions**: hidden when **Disable bypass permissions mode** is ticked
  - **Read-safe (edits + read-only commands)**: Grove Bench's own mode, under the "Grove Bench" divider; everything else prompts
- **Tool Allow Rules** / **Tool Deny Rules** — Rules the app applies before the agent asks. Deny rules win. A rule is `<tool>` or `<tool>(<glob>)`, where `<tool>` is a neutral keyword that works for every agent: `shell` (the glob matches the command), `edit` and `read` (the file path), `web` (the URL), `agent` (the sub-agent prompt), `question`, or `mcp` (the tool name after `mcp__`). A provider's own tool name also works, e.g. `Bash(git push *)`. `*` matches anything. Examples: `shell(npm run *)`, `edit(src/**)`, `read(**/.env*)`, `web(*github.com*)`, `mcp(github__*)`

## Agent

Configure agent behavior. There is one group per installed agent, each with:

- **Credentials** — Shows how the agent signs in. Paste an API key to save it (stored encrypted on this computer), or remove a saved key. While a key is saved it is used instead of a CLI sign-in
- **Default Model** — Pick the model new conversations with this agent start on. The list comes from the agent itself and updates after a conversation starts, so new models appear without an app update. **Default** follows the agent's own default model (shown in brackets). A model ID typed in an older version stays in the list, marked "custom"
- **Background Model** — The model used for this agent's background tasks: memory notes, memory compaction, commit messages and skill suggestions. **Default** is the agent's own cheap model (Haiku 4.5 for Claude Agent). Each task runs on the agent of the conversation it belongs to, so a conversation's content only goes to the provider you chose for it
- **Default Effort**, **Default Thinking**, **Default Speed** — The conversation controls the agent declares for its default model (for Claude Agent, each one shows only when the default model offers it). Pick the value new conversations start with; each conversation can still change it from the status bar

These apply to every agent:

- **System Prompt Append** — Add custom instructions that apply to all conversations
- **Additional Working Directories** — Extra directories the agent can access

## General

- **Default Base Branch** — The branch used as the base when creating new worktrees (e.g. `main`)
- **Project Colors** — Customize the accent color for each project in the sidebar
- **Always on top** — Keep the Grove Bench window above other windows
- **Enable spell checking** — Turn spell checking in the prompt editor on or off
- **Default Diff View** — Choose between unified or side-by-side diffs
- **Desktop Notifications** — Native OS notifications, shown only while the window is unfocused: when an agent finishes a turn, when it's waiting on a permission or question, and on PR activity (new CI failures, review comments). Clicking a notification jumps to the conversation. **Flash the taskbar button** controls whether the taskbar button also flashes; it stops as soon as the window regains focus
- **Auto-install dependencies in new worktrees** — Run `npm install` automatically when a worktree is created (off by default)

## MCP

View the MCP servers configured in Claude Code and add new ones without leaving the app:

- The list shows each configured server with its live health status (the check can take a few seconds)
- **Add MCP Server** — Register a new server by name, transport (stdio command, HTTP, or SSE), and scope:
  - **User** — available in all projects on this machine
  - **Project** — shared with your team via `.mcp.json` in the chosen project's repository
  - **Local** — only this machine, only the chosen project
- stdio servers accept arguments and environment variables; HTTP/SSE servers accept request headers
- New and restarted conversations pick up added servers automatically; running conversations must be restarted

## Plugins

Browse and manage MCP server plugins that extend the agent's capabilities. Plugins can provide additional tools like web search, database access, or integration with external services.
