# Getting Started

Grove Bench is a multi-agent git worktree orchestrator for Claude Code. It lets you run multiple AI coding conversations at the same time, each in an isolated git worktree with its own terminal.

## Adding a Project

Click the **+ Project** button at the bottom of the sidebar to add a project. Browse to the folder containing your git repository and select it. The project will appear in the sidebar, ready for new conversations. A project must be a git repository for now.

## Starting a Conversation

Click the **+ Conversation** button at the bottom of the sidebar to open the **New Conversation** dialog. If more than one agent is installed, pick one under **Agent**; otherwise the dialog skips that choice.

The first time you use an agent, you may be asked for its credentials. Paste an Anthropic API key (**Get a key** opens the Claude Console) and click **Save key**. The key is stored encrypted on this computer. If you already signed in with `claude auth login` in a terminal, or set `ANTHROPIC_API_KEY`, click **Re-check** instead. You can change or remove the key later in **Settings > Agent**.

Pick a project, then choose one of three options under **Branch Mode**:

- **New branch** — Creates a new branch and a new worktree for it, so the agent's changes stay away from your other branches. This is the recommended choice for most tasks. Enter a **Branch Name**, and optionally a **Base Branch** (a branch, tag or commit hash) to start from. The base is prefilled with **Default Base Branch** from **Settings → General**, or the project's default branch (e.g. `main`), and Grove Bench fetches its latest commits from `origin` first when it can.
- **Existing branch** — Creates a new worktree for a branch that already exists, local or remote. The list leaves out branches that another conversation in this project is already using.
- **Direct** — Runs the agent in the project folder itself, on whatever branch is checked out there. No worktree is created and changes are made in place. Use this for quick tasks where isolation isn't needed.

Click **Create** to start the conversation.

## Interacting with an Agent

Once a conversation is running, type your instructions in the **prompt editor** at the bottom of the workspace. The agent will:

1. Read and understand your request
2. Explore your codebase as needed
3. Make changes, run commands, and iterate
4. Ask for permission before potentially destructive actions

You can monitor progress in the **Activity** tab and review file changes in the **Changes** tab.
