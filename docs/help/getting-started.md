# Getting Started

Grove Bench is a multi-agent git worktree orchestrator for Claude Code. It lets you run multiple AI coding conversations at the same time, each in an isolated git worktree with its own terminal.

## Adding a Project

Click the **+ Project** button at the bottom of the sidebar to add a project. Browse to the folder containing your git repository and select it. The project will appear in the sidebar, ready for new conversations. A project must be a git repository for now.

## Starting a Conversation

Click the **+ Conversation** button at the bottom of the sidebar, or press `Ctrl+N`, to open the **New Conversation** dialog. If more than one agent is installed, pick one under **Agent**; otherwise the dialog skips that choice.

The first time you use an agent, you may be asked for its credentials. Paste an Anthropic API key (**Get a key** opens the Claude Console) and click **Save key**. The key is stored encrypted on this computer. If you already signed in with `claude auth login` in a terminal, or set `ANTHROPIC_API_KEY`, click **Re-check** instead. You can change or remove the key later in **Settings > Agent**.

Pick a project, then choose what the conversation starts from:

- **New work** — Type what the agent should work on and press `Enter` (`Shift+Enter` adds a new line). Grove Bench creates a new branch and a new worktree for it, so the agent's changes stay away from your other branches, and sends your message as the first turn. The message is optional: you can also start empty and type in the conversation.
  - **Branch name** — You don't have to pick one. The branch starts with a temporary name (`grove/` and a short id) and is renamed after the agent's first reply, from your message and the style of the project's recent branch names. Put a ticket ID in the message (e.g. `API-123`) to have it included. To describe the style in your own words, set **Branch Naming Rule** in **Settings → General**. A branch that has already been pushed keeps its name.
  - **Options** — Set a **Branch name** yourself, or a **Base branch** (a branch, tag or commit hash) to start from. The base is prefilled with **Default Base Branch** from **Settings → General**, or the project's default branch (e.g. `main`), and Grove Bench fetches its latest commits from `origin` first when it can. **Work in the project folder** runs the agent in the project folder itself, on whatever branch is checked out there. No worktree is created and changes are made in place.
- **Existing branch** — Pick an open pull request or a branch that already exists, local or remote, and Grove Bench creates a new worktree for it. Open pull requests are listed when the GitHub CLI (`gh`) is installed and signed in; ones from forks are not listed yet. The list leaves out branches that another conversation in this project is already using. Picking a pull request ticks **Start in Plan mode**, so the agent explores and reports without editing files; untick it to let the agent make changes. Add an optional **First message**, such as "Review this PR".

Click **Start** to start the conversation.

## Interacting with an Agent

Once a conversation is running, type your instructions in the **prompt editor** at the bottom of the workspace. The agent will:

1. Read and understand your request
2. Explore your codebase as needed
3. Make changes, run commands, and iterate
4. Ask for permission before potentially destructive actions

You can monitor progress in the **Activity** tab and review file changes in the **Changes** tab.
