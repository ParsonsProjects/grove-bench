# Settings

Open Settings from the gear icon in the sidebar bottom controls. Settings are organized into tabs.

## Permissions

Control how the agent handles actions that need approval:

- **Default permission mode** — The mode new conversations start in: Default (ask before edits and non-trivial commands), Accept Edits, Plan (read-only), Auto (Claude's classifier approves or blocks each action), Bypass Permissions, or, under the "Grove Bench" divider, Read-safe (edits and read-only commands run without asking; everything else prompts). See [Status bar](status-bar.md#mode) for what each mode allows
- **Tool allow / deny rules** — Rules the app applies before the agent asks. Deny rules win. A rule is `<tool>` or `<tool>(<glob>)`, where `<tool>` is a neutral keyword that works for every agent: `shell` (the glob matches the command), `edit` and `read` (the file path), `web` (the URL), `agent` (the sub-agent prompt), `question`, or `mcp` (the tool name after `mcp__`). A provider's own tool name also works, e.g. `Bash(git push *)`. `*` matches anything. Examples: `shell(npm run *)`, `edit(src/**)`, `read(**/.env*)`, `web(*github.com*)`, `mcp(github__*)`

## Agent

Configure agent behavior:

- **Default Model** — Select which Claude model to use for new conversations
- **Agent defaults** — One group per installed agent, listing the conversation controls that agent declares for the default model (for Claude Code: Thinking, and Speed on models that support fast mode). Pick the value new conversations start with; each conversation can still change it from the status bar
- **System Prompt Append** — Add custom instructions that apply to all conversations
- **Additional Working Directories** — Extra directories the agent can access

## General

- **Default Base Branch** — The branch used as the base when creating new worktrees (e.g. `main`)
- **Project Colors** — Customize the accent color for each project in the sidebar
- **Always on Top** — Keep the Grove Bench window above other windows
- **Keep running in the system tray** — The close button hides the window to the system tray instead of quitting, so your conversations keep running. Click the tray icon to reopen the window, or right-click it and choose Quit. The tray tooltip shows how many conversations need attention while the window is hidden. On by default
- **Spell Check** — Enable or disable spell checking in the prompt editor
- **Default Diff View** — Choose between unified or side-by-side diffs
- **Desktop Notifications** — Native OS notifications, shown only while the window is unfocused: when an agent finishes a turn, when it's waiting on a permission or question, and on PR activity (new CI failures, review comments). Clicking a notification jumps to the conversation. The taskbar-flash toggle controls whether the taskbar button also flashes; it stops as soon as the window regains focus
- **Auto-install Dependencies** — Automatically run dependency installation in new worktrees

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
