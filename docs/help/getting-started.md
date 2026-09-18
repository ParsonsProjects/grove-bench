# Getting Started

Grove Bench is a multi-agent git worktree orchestrator for Claude Code. It lets you run multiple AI coding conversations at the same time, each in an isolated git worktree with its own terminal.

## Adding a Project

Click the **+ Project** button at the bottom of the sidebar to add a project. Browse to the folder containing your git repository and select it. The project will appear in the sidebar, ready for new conversations. A project must be a git repository for now.

## Starting a Conversation

Click the **+ Agent** button to start a new conversation. You have three options:

- **New Worktree** — Creates a new git branch and worktree for isolated work. This is the recommended approach for most tasks, as changes are completely isolated from your main branch.
- **Existing Worktree** — Attach to a worktree that already exists on disk.
- **Direct** — Run the agent directly in the repository without creating a worktree. Use this for quick tasks where isolation isn't needed.

When creating a new worktree, you'll choose a base branch (e.g. `main`) and name your new branch.

## Interacting with an Agent

Once a conversation is running, type your instructions in the **prompt editor** at the bottom of the workspace. The agent will:

1. Read and understand your request
2. Explore your codebase as needed
3. Make changes, run commands, and iterate
4. Ask for permission before potentially destructive actions

You can monitor progress in the **Activity** tab and review file changes in the **Changes** tab.
