# Settings

Open Settings from the gear icon in the sidebar bottom controls. Settings are organized into tabs.

## Permissions

Control how the agent handles actions that need approval:

- **Default permission mode** — Choose between allowing all actions, requiring approval for potentially destructive actions, or requiring approval for everything
- **Allowed tools** — Configure which specific tools the agent can use without asking

## Agent

Configure agent behavior:

- **Default Model** — Select which Claude model to use for new sessions
- **Extended Thinking** — Enable or disable extended thinking (deeper reasoning) by default
- **Dev Server Command** — Command to run a dev server in new worktrees (e.g. `npm run dev`)
- **System Prompt Append** — Add custom instructions that apply to all sessions
- **Additional Working Directories** — Extra directories the agent can access

## General

- **Default Base Branch** — The branch used as the base when creating new worktrees (e.g. `main`)
- **Repository Colors** — Customize the accent color for each repository in the sidebar
- **Always on Top** — Keep the Grove Bench window above other windows
- **Spell Check** — Enable or disable spell checking in the prompt editor
- **Default Diff View** — Choose between unified or side-by-side diffs
- **Auto-install Dependencies** — Automatically run dependency installation in new worktrees

## Plugins

Browse and manage MCP server plugins that extend the agent's capabilities. Plugins can provide additional tools like web search, database access, or integration with external services.
