# Getting Started

Grove Bench is a multi-agent git worktree orchestrator for Claude Code. It lets you run multiple AI coding conversations at the same time, each in an isolated git worktree with its own terminal.

## Adding a Project

Click the **+ Project** button at the bottom of the sidebar to add a project. Browse to the folder containing your git repository and select it. The project will appear in the sidebar, ready for new conversations. A project must be a git repository for now.

## Starting a Conversation

Click **+** next to a project in the sidebar to start a conversation in that project. **+ Conversation** at the bottom of the sidebar, and `Ctrl+N`, do the same in the project of the conversation you have open.

This opens a new conversation as a draft: nothing is created until you send the first message. Type what the agent should work on and press `Enter` (`Shift+Enter` adds a new line), or click **Start**. The message is optional: you can also start empty and type in the conversation. **Discard** throws the draft away. While a draft exists it shows at the top of **Conversations** in the sidebar, so you can open another conversation and come back to it.

Before you send, the draft's status bar lets you change the choices that are fixed once the conversation starts:

- **Agent settings** (left) — Pick the agent, the model, the mode and the other controls the agent offers. A new draft uses the agent and model of the conversation you had open, or your defaults. Once the conversation starts, the model and controls can still change but the agent can't.
- **Project / branch** (next to it) — Click the project name to move the draft to another project. Click the branch to choose where the agent works:
  - **New branch** (the default) — A separate copy of the project (a worktree) on a new branch, so the agent's changes stay away from your other work. You don't have to name the branch. It starts with a temporary name (`grove/` and a short id) and is renamed after the agent's first reply, from your message and the style of the project's recent branch names. Put a ticket ID in the message (e.g. `API-123`) to have it included. To describe the style in your own words, set **Branch Naming Rule** in **Settings → General**. A branch that has already been pushed keeps its name. **Base branch** is prefilled with **Default Base Branch** from **Settings → General**, or the project's default branch (e.g. `main`), and Grove Bench fetches its latest commits from `origin` first when it can.
  - **Branch or PR** — A separate copy of an open pull request or a branch that already exists, local or remote. Open pull requests are listed when the GitHub CLI (`gh`) is installed and signed in; ones from forks are not listed yet. The list leaves out branches that another conversation in this project is already using. Picking a pull request switches the mode to **Plan**, so the agent explores and reports without editing files, unless you already picked a mode.
  - **Project folder** — The agent works in the project folder itself, on whatever branch is checked out there. No separate copy is made and changes land in place.

The first time you use an agent, the draft may ask for its credentials. For Claude there are two ways in:

- **Use your Claude plan** (Pro, Max, Team or Enterprise): install Claude Code (**How to install Claude Code** opens Anthropic's setup page), run `claude` in a terminal and sign in when it asks, then click **Re-check**. Grove Bench never sees your sign-in; the agent reads it itself.
- **Or use an API key**: paste an Anthropic API key (**Get a key** opens the Claude Console) and click **Save key**. API usage is billed per use by Anthropic, separately from any Claude plan. The key is stored encrypted on this computer, and while saved it is used instead of a plan sign-in. You can change or remove it later in **Settings > Agent**.

If you already set `ANTHROPIC_API_KEY`, just click **Re-check**.

## Interacting with an Agent

Once a conversation is running, type your instructions in the **prompt editor** at the bottom of the workspace. The agent will:

1. Read and understand your request
2. Explore your codebase as needed
3. Make changes, run commands, and iterate
4. Ask for permission before potentially destructive actions

You can monitor progress in the **Activity** tab and review file changes in the **Changes** tab.

## Finishing a Conversation

When the agent is done, its work sits on the conversation's own branch, in a separate copy of the project. To bring it into your main branch:

1. **Review**: open the **Changes** tab (`Alt+2`). **Uncommitted** shows what isn't committed yet; **Branch** shows everything since the conversation left its base branch.
2. **Commit**: stage files, write a message (or generate one) and click **Commit**. You can also ask the agent to commit for you.
3. **Merge or open a pull request**:
   - **Merge into main** (the button names your base branch) sits at the bottom of the Changes tab. It shows what will happen, then merges the branch into that branch in your project folder. The project folder must have that branch checked out with no uncommitted changes. If both sides changed the same lines, the merge is stopped and nothing changes: ask the agent to rebase onto the base branch and fix the conflicts, then merge again. Nothing is pushed.
   - **Create PR** in the status bar pushes the branch and opens a pull request. It shows when the GitHub CLI (`gh`) is installed and signed in. Without it, **& Push** next to **Commit** pushes the branch so you can open a pull request on your git host's website.
4. **Tidy up**: right-click the conversation and choose **Mark Completed** to hide it, or **Delete Conversation** to remove its copy of the project.

A conversation that works in the **Project folder** changes your files in place, so there is nothing to merge.
