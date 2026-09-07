# Settings

Open Settings from the gear icon in the sidebar bottom controls. Settings are organized into tabs.

## Permissions

Control how the agent handles actions that need approval:

- **Default permission mode** — Choose between allowing all actions, requiring approval for potentially destructive actions, or requiring approval for everything
- **Allowed tools** — Configure which specific tools the agent can use without asking

## Agent

Configure agent behavior:

- **Default Model** — Select which Claude model to use for new sessions
- **Default Thinking Level** — How much extended thinking (deeper reasoning) new sessions use: Off, Low, Medium, High (provider default), or Adaptive (the model decides when and how much to think)
- **System Prompt Append** — Add custom instructions that apply to all sessions
- **Additional Working Directories** — Extra directories the agent can access

## General

- **Default Base Branch** — The branch used as the base when creating new worktrees (e.g. `main`)
- **Repository Colors** — Customize the accent color for each repository in the sidebar
- **Always on Top** — Keep the Grove Bench window above other windows
- **Spell Check** — Enable or disable spell checking in the prompt editor
- **Default Diff View** — Choose between unified or side-by-side diffs
- **Desktop Notifications** — Native OS notifications, shown only while the window is unfocused: when an agent finishes a turn, when it's waiting on a permission or question, and on PR activity (new CI failures, review comments). Clicking a notification jumps to the session. The taskbar-flash toggle controls whether the taskbar button also flashes; it stops as soon as the window regains focus
- **Auto-install Dependencies** — Automatically run dependency installation in new worktrees

## MCP

View the MCP servers configured in Claude Code and add new ones without leaving the app:

- The list shows each configured server with its live health status (the check can take a few seconds)
- **Add MCP Server** — Register a new server by name, transport (stdio command, HTTP, or SSE), and scope:
  - **User** — available in all projects on this machine
  - **Project** — shared with your team via `.mcp.json` in the chosen repository
  - **Local** — only this machine, only the chosen repository
- stdio servers accept arguments and environment variables; HTTP/SSE servers accept request headers
- New and restarted sessions pick up added servers automatically; running sessions must be restarted

## Plugins

Browse and manage MCP server plugins that extend the agent's capabilities. Plugins can provide additional tools like web search, database access, or integration with external services.
