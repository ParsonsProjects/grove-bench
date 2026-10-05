# Getting Started

Grove Bench lets you run several AI coding threads with Claude Code at the same time, each with its own terminal. In a git project, each thread works in its own copy of the project (a git worktree), so their changes stay apart. A folder without git works too, but its threads edit the folder directly.

## Quick Start

1. **Add a project**: click **Add a project** on the first screen (or **+ Project** at the bottom of the sidebar) and pick your project's folder.
2. **Start a thread**: click **Start a thread**, or **+** next to the project in the sidebar.
3. **Sign in, the first time only**: the new thread asks for Claude credentials if it can't find any (see below).
4. **Say what to work on** and press `Enter`.

If [git](https://git-scm.com/downloads) isn't installed, the first screen and each new thread say so. Threads still run without it, but they edit your project folder in place.

## Signing In

The first time you start a thread, it may ask for the agent's credentials. Claude Agent runs on Claude Code, so it signs in the same way. There are two ways in:

- **Use your Claude plan** (Pro, Max, Team or Enterprise): install Claude Code (copy the install command shown, or **How to install Claude Code** opens Anthropic's setup page), run `claude` in a terminal and sign in when it asks, then click **Re-check**. Grove Bench never sees your sign-in; the agent reads it itself.
- **Or use an API key**: paste an Anthropic API key (**Get a key** opens the Claude Console) and click **Save key**. Grove Bench checks the key with Anthropic before saving it, so a mistyped key is turned away there and then. If Anthropic can't be reached, the key is saved anyway and your first message shows whether it works. API usage is billed per use by Anthropic, separately from any Claude plan. The key is stored encrypted on this computer, and while saved it is used instead of a plan sign-in. You can change or remove it later in **Settings → Agents (Grovekeepers)**.

If you already set `ANTHROPIC_API_KEY`, just click **Re-check**.

If a thread can't sign in later (a key was revoked, or the plan sign-in expired), the Thread tab says so with a link to **Settings → Agents (Grovekeepers)**, and new threads ask for credentials again until you replace or remove the key.

### Other agents

Gemini CLI, GitHub Copilot CLI and OpenCode are separate programs. When one isn't installed, a new thread shows the command that installs it with a copy button; run it in a terminal (Grove Bench never runs it for you), then click **Re-check**.

- **GitHub Copilot CLI** signs in with your GitHub Copilot plan: copy `copilot login`, run it in a terminal, then click **Check sign-in**. That starts Copilot CLI for a moment to see whether it lets Grove Bench in.
- **Gemini CLI** stopped working with personal Google accounts on 18 June 2026. A Gemini API key works (**Get a key** opens Google AI Studio; billed by Google through the Gemini API), as does a Gemini Code Assist Standard or Enterprise sign-in or Vertex AI set up in Gemini CLI itself. If Gemini CLI was set to sign in another way, saving a key switches it to the key, and Gemini CLI remembers that.

When an agent turns the sign-in down, the Thread tab shows the agent's own reason, and new threads with it ask you to sign in until a check or a thread gets through.

## Adding a Project

Click the **+ Project** button at the bottom of the sidebar to add a project. Browse to your project's folder and select it. The project will appear in the sidebar, ready for new threads. Pick a folder inside a git repository and the repository's top-level folder is added.

A folder that isn't a git repository (or any folder, when git isn't installed) is added as it is. Each thread in it works in the folder itself: there is no separate copy and no branch, the agent edits your files in place, and its edits can't be rewound. The **Changes** and **Checkpoints** tabs say they need git, and rewinding a message only resets the thread. To get separate copies, branches and rewinding, run `git init` in the folder and make a first commit; the next thread you start there uses git. Threads that already exist keep running without it.

## Starting a Thread

Click **+** next to a project in the sidebar to start a thread in that project. **+ Thread** at the bottom of the sidebar, and `Ctrl+N`, do the same in the project of the thread you have open.

This opens a new thread as a draft: nothing is created until you send the first message. Type what the agent should work on and press `Enter` (`Shift+Enter` adds a new line), or click **Start**. The message is optional: you can also start empty and type in the thread. **Discard** throws the draft away. While a draft exists it shows at the top of **Threads** in the sidebar, so you can open another thread and come back to it.

Before you send, the draft's status bar lets you change the choices that are fixed once the thread starts:

- **Agent settings** (left) — Pick the agent, the model, the mode and the other controls the agent offers. A new draft uses the agent and model of the thread you had open, or your defaults. Once the thread starts, the model and controls can still change but the agent can't.
- **Project / branch** (next to it) — Click the project name to move the draft to another project. Click the branch to choose where the agent works:
  - **New branch** (the default) — A separate copy of the project (a worktree) on a new branch, so the agent's changes stay away from your other work. You don't have to name the branch. It starts with a temporary name (`grove/` and a short id) and is renamed after the agent's first reply, from your message and the style of the project's recent branch names. Put a ticket ID in the message (e.g. `API-123`) to have it included. To describe the style in your own words, set **Branch naming rule** in **Settings → Git & worktrees (Branches & roots)**. A branch that has already been pushed keeps its name. **Base branch** is prefilled with **Default base branch** from **Settings → Git & worktrees (Branches & roots)**, or the project's default branch (e.g. `main`), and Grove Bench fetches its latest commits from `origin` first when it can.
  - **Branch or PR** — A separate copy of an open pull request or a branch that already exists, local or remote. Open pull requests are listed when the GitHub CLI (`gh`) is installed and signed in; ones from forks are not listed yet. The list leaves out branches that another thread in this project is already using.
  - **Project folder** — The agent works in the project folder itself, on whatever branch is checked out there. No separate copy is made and changes land in place.

The first time you use an agent, the draft may ask for its credentials first (see [Signing In](#signing-in)).

## Interacting with an Agent

Once a thread is running, type your instructions in the **prompt editor** at the bottom of the workspace. The agent will:

1. Read and understand your request
2. Explore your codebase as needed
3. Make changes, run commands, and iterate
4. Ask for permission before potentially destructive actions

You can monitor progress in the **Thread** tab and review file changes in the **Changes** tab.

## Finishing a Thread

When the agent is done, its work sits on the thread's own branch, in a separate copy of the project. To bring it into your main branch:

1. **Review**: open the **Changes** tab (`Alt+2`). **Uncommitted** shows what isn't committed yet; **Branch** shows everything since the thread left its base branch.
2. **Commit**: stage files, write a message (or generate one) and click **Commit**. You can also ask the agent to commit for you.
3. **Open a pull request or merge**:
   - **Create PR** in the status bar pushes the branch and opens a pull request. It shows when the GitHub CLI (`gh`) is installed and signed in.
   - Without it, **& Push** next to **Commit** pushes the branch so you can open a pull request on your git host's website.
   - To merge without a pull request, run `git merge <branch>` in your project folder. The branch name is shown in the status bar.
4. **Tidy up**: right-click the thread and choose **Close Thread** to stop its agent and take it off the Threads list, or **Delete Thread** to remove its copy of the project.

A thread that works in the **Project folder** changes your files in place, so there is nothing to merge. The same goes for every thread in a project used without git.

If git has no name and email for the project, the new thread screen says so before you send, since the agent's commits would fail without them.
