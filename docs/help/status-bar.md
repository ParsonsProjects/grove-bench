# Status Bar

The status bar sits at the bottom of the workspace, just above the prompt, and shows live information about the open thread.

It is one row of small buttons, each a word or two and a coloured dot, with the details in a popup you open by clicking it. From the left: **Agent settings**, **Activity** and **Branch**, then on the right **MCP · Skills** and **Context**. `Esc` or clicking outside closes a popup and puts the focus back on its button.

In a narrow window the buttons shrink rather than disappear. The model name and the branch name are cut shorter (hover for them in full), **MCP · Skills** keeps only its dot, and **Context** keeps only its percentage. The list of keyboard shortcuts is under Keyboard Shortcuts in Help (`F1`).

## Agent Settings

The left side is a single **Agent settings** control, on one line: the model and the mode, then any control that is off its default, for example `Opus 5.5 · Ask · Low · Fast`. A long model name is cut short; hovering shows it in full, with the agent's name. Click it to open a popup with one column per setting: **Agent**, **Model**, and each control the provider declares for that model (Mode, Effort, Thinking, Speed). Pick an option in any column; the change applies immediately. A line under the columns says what the current mode does, or what any option you point at or tab to does. `Esc` or clicking outside closes the popup. Picking another agent asks how to switch. **Switch and send the transcript** hands this thread to it: it starts its own session in the same worktree, and with your next message it gets a short transcript of the thread so far (your messages, the replies and the list of files changed, without tool output), which goes to that agent's provider. **Switch without it** does the same with no transcript, so the new agent starts knowing nothing but your files. Either way the thread, the files and the checkpoints stay, the thread marks where the switch happened, the model, mode and controls change to the new agent's (the mode is kept when it offers it), and memory notes and other background work on the new agent only read what came after the switch. **New thread instead** starts a draft with that agent in the same project and leaves this one as it is. In a draft (see [Getting started](getting-started.md#starting-a-thread)) every column can still change, the agent included.

### Usage

Under the agent, the popup shows your **plan usage**: one bar per rate-limit window (for example 5-hour and Weekly, plus per-model weekly windows when your plan has them) with the percentage used and when it resets. Like the context meter, each bar is a row of pixel blocks, here 5% each, in the same colours. It refreshes when you open the popup and after each turn, and live rate-limit headers keep it current in between. Usage is per sign-in, so every thread on the same account shows the same numbers. API-key and third-party sign-ins have no plan limits, and the popup says so instead.

### Mode

The operating mode controls how much the agent may do without asking:

| Mode | Color | Description |
|------|-------|-------------|
| **Ask** | Blue | Default mode: the agent checks with you before each edit or command. Reading files and read-only commands run without asking |
| **Plan** | Yellow | Planning mode — the agent explores and plans but doesn't edit files |
| **Edit** | Purple | Accept-edits mode — file edits inside the worktree are applied without asking; commands still prompt |
| **Auto** | Cyan | Claude Code's native auto mode — a classifier model reviews each action instead of you. Read-only actions and in-worktree edits are approved; risky or out-of-scope actions (force push, `curl \| bash`, secrets, mass deletion) are blocked and shown as a status line rather than prompted. Not offered on models that don't support it (Haiku) |
| **Read-safe** | Green | Grove's own mode — edits and recognised read-only commands (file reads, `git status`, `git log`, `ls`, `grep`, …) run without asking. Anything that writes, reaches outside the worktree, touches the network, or isn't on the allowlist still prompts. A sandbox confines writes to the worktree as a backstop |

Pick a mode in the Agent settings popup, or press `Alt+M` to cycle through them. The first four are Claude Code's own modes. Read-safe is Grove Bench's, so it sits below a divider headed "Grove Bench" in the mode list and in Settings.

Agents other than Claude Code (Gemini CLI, GitHub Copilot CLI, OpenCode and agents you add) get Ask, Edit and Read-safe. They have no OS sandbox, so in Read-safe the read-only check is the only thing between the agent and your files. Their own modes show as a second column, named by the agent (for example Gemini CLI's **Agent mode**). A mode that runs tools without asking, such as Gemini CLI's **YOLO**, shows in red. When the agent changes its own mode, for example leaving Plan by itself, the badge follows.

Read-safe and Auto differ in who decides: Read-safe uses a fixed allowlist inside Grove and asks you about everything else, so nothing unexpected ever runs unprompted. Auto hands the decision to Claude's classifier and rarely prompts, so the agent can run tests, commit and so on without you, at the cost of a model making the call.

The Mode, Effort, Thinking and Speed columns are declared by the agent provider for the model you have selected, so the options you see are exactly the ones that provider and model support. Switching models can add or remove a column (for example, Fast speed is only offered on models that support it) and resets any choice the new model does not offer to its default.

## Activity

Next to the agent settings, one word says what the agent is doing:

| Word | Meaning |
|------|---------|
| **Ready** | Waiting for your next message |
| **Thinking** (purple), **Writing**, or a tool's name (yellow) | The agent is working on it; a blue square pulses beside the word |
| **Needs you** (amber) | A permission prompt, a question or an MCP form is waiting for your answer in the Thread tab. It shows over whatever the agent was doing |
| **Subagent** | Only a subagent's tools are still running, so the agent itself may be idle |
| **Background** | A background task is still running |
| **Compacting** | Project memory is being compacted |
| **Rate limited** (red) | Requests are being throttled |

The button keeps one width whatever the word, so the bar doesn't shift. A rate-limit warning puts a small amber mark on its corner.

Click it for the details: what the agent is doing (with a running tool's command and how long it has taken), the rate limit and when it resets, the tools still running, the background tasks, and then the thread's **Tasks**, **Files** and **Last turn**. Under **Needs you**, **Show** opens the Thread tab. A subagent's tools show which subagent they run in (**in Explore**); click one to open that subagent's thread.

### Tasks and Files

At the foot of the popup, two rows show what the thread holds besides its messages. Each shows only once there is something in it. Click one to see its list in the popup; **‹ Activity** goes back.

**Tasks** is the agent's to-do list, for example `2 of 5 done` (cancelled tasks don't count). Done tasks are ticked and struck through, and the one in progress is in bold. **Show in thread** opens the Thread tab at the message that last changed the list. The list comes from Claude Code's to-do and task tools, the plan an ACP agent sends, and OpenCode's to-do tool. It is always the latest one, so a list from an earlier turn stays until the agent changes it.

**Files** counts the files that came into the thread. Its list is newest first, in three groups:

- **You attached**: images, text files and other files you added to your messages.
- **Made by the agent**: what each turn's **Files made** list shows.
- **From tools**: images a tool returned, such as a screenshot.

Click a file to open it the way its chip in the thread does: an image full size, a text file in the Focus panel (Markdown rendered, anything else with line numbers), a web page in the Preview tab, and PDFs, media and documents in their default app. The target button beside it opens the Thread tab at the message the file came with. If that message is hidden in Summary or Focus view, the thread switches to Detailed to show it. A file that is gone (a rewind took its message, or the agent deleted it) is greyed out once you try to open it.

A file that came in more than once is listed once, at the latest message. A subagent's own to-do list and screenshots stay in its thread.

### Last turn

The **Last turn** row says how long the last turn took. With an API key sign-in it also shows what the turn cost, estimated at list price (hover for the exact figure), with the thread's and today's totals and the tokens used. On a plan such as Pro or Max the cost is left out, because turns count toward the plan's limits rather than a bill; **Usage** in Agent settings shows how much of the plan you've used. **Limits & alerts** opens the settings for spending alerts.

## Branch

The **Branch** button shows one icon and the thread's branch. The icon's shape says how far the branch has got on its way to merged:

| Icon | Meaning |
|------|---------|
| Branch | No pull request yet |
| Pull request | A PR is open |
| Pull request, dashed | A draft PR |
| Merge | The PR was merged |
| Pull request with an X | The PR was closed without merging |

Its colour says what matters most right now:

| Colour | Meaning |
|--------|---------|
| Red | The push or a check failed |
| Amber | Waiting on you, such as changes requested |
| Blue pulsing | Checks running |
| Green | Every step before the merge is done, on a PR that isn't a draft |
| Purple | Merged |
| Grey | The PR was closed without merging |
| Plain | A step is still to come, such as a push or a review |

A small green square at the end of the button means the popup has something for you to do now: commits to push, a PR to open, a failed push or check, or changes requested. The icon pulses while there is PR activity you haven't looked at, and dims when the last fetch from GitHub failed, so it may be out of date. If a merge or rebase stopped part way, its word (for example **rebasing 1/2**) shows in amber beside the branch name. Hovering the button says all of it in words.

Click it for the popup. It names the project and branch (and how far behind its upstream the branch is), then lists the steps on the way to merged, **Push**, **PR**, **Checks**, **Review** and **Merge**, each with a dot and what it stands at.

| Dot | Meaning |
|-----|---------|
| Green | Done |
| Hollow and bright | The step to take now, such as commits to push |
| Blue pulsing | Running, such as checks |
| Red | Failed: the push or a check |
| Amber | Waiting on you, such as changes requested |
| Purple | Merged |
| Grey | The PR was closed without merging |
| Hollow and faint | Not reached yet |

Each step's row also has what goes with it:

- **PR**: the pull request's number, state and title, with **Open ↗** to see it on GitHub. Hover the state for the branch it merges from and into.
- **Checks**: the names of the failing checks, a **new** chip when they failed since you last looked, and **fix with agent →**, which sends a turn asking the agent to read the CI logs and fix them.
- **Review**: a **2 new** chip for comments since you last looked, and **address with agent →**, which fetches the review comments and asks the agent to address them. Hover **review required** for what it means.

Clicking a chip clears it, and so does closing the popup. When an auto turn gives up and needs you, a note says so under the steps until you dismiss it. Under them, **Auto** turns on the agent fixing CI or addressing reviews by itself (only for an open PR, and only while the thread is idle), and **Other PRs in this thread** lists any others, with **watch** to follow one of them instead.

The actions are at the bottom:

- **Push N commits** pushes the branch. If a push fails, from here or from the Changes tab, the error shows in the popup: copy it, **Retry** the push or **Dismiss** the note. It also goes away by itself once nothing is left to push.
- **Create PR with agent** sends a turn asking the agent to commit, push and open a PR. **Create PR manually…** opens a form. They show while the thread has no open PR, so after a PR is merged or closed they start a new one. Both wait while the agent is working.
- **Switch branch…** opens the branch picker in place of the popup.
- A merge or rebase stopped part way has a line at the top that opens the Changes tab, where you finish or abort it.

### Switching branch

Type to filter local and remote branches, then click one or press `Enter`. If the name you type doesn't exist yet, **Create branch** makes it from the current commit and switches to it.

- A branch that only exists on the remote gets a local branch that tracks it.
- Switching is refused while the checkout has uncommitted changes or untracked files, so commit, stash or remove them first. Creating a new branch is still allowed: no files change, so your uncommitted work comes along.
- A branch can only be checked out in one place. A branch in use by another worktree (your project folder included) can't be picked.
- **Switch branch…** can't be clicked while the agent is working, a background agent included. Switch once it's done.
- Threads that share a checkout move together. For a direct thread that checkout is your project folder, so your editor sees the switch too.
- Closing a thread with "Also delete the branch" never deletes the project's default branch, even if the thread switched onto it.

## Speed

On models that support it, a **Speed** column switches between **Standard** and **Fast** output. Fast keeps the same model but returns responses more quickly.

## Effort

An **Effort** control sets how much the agent reasons before it acts. Higher effort means more thorough work, but it takes longer and uses your plan limits faster. Pick a level in the Agent settings popup, or press `Alt+E` to cycle through the levels the current model offers:

| Level | Meaning |
|-------|---------|
| **Low** | Fastest and cheapest; brief reasoning |
| **Medium** | Balanced speed and depth |
| **High** | Deep reasoning |
| **Extra** | Deeper than High; suits long coding and agentic work |
| **Max** | Uncapped reasoning; slow and token-hungry, for the hardest tasks |

Each model starts on its own default: **Medium** for Opus 5.5, **Extra** for Opus 4.7, and **High** for the others. Opus 4.6 and Sonnet 4.6 don't offer Extra. Haiku 4.5 has no effort setting.

Other agents list their own levels, which can depend on the model (OpenCode offers Low, High and Max on DeepSeek V4.1 Flash). `Alt+E` cycles those too.

## Thinking

On most models a **Thinking** control switches extended thinking **On** (the model decides when and how much to think, and Effort sets how much) or **Off**. Pick it in the Agent settings popup, or press `Alt+T` to toggle it.

- Opus 5.5 and Fable 5 always think, so they show no Thinking control. Use a lower Effort to make them faster.
- Haiku 4.5 has no Effort setting, so its Thinking control keeps fixed levels: **Off**, **Low**, **Medium**, and **High**.

While the agent reasons, the status bar shows **Thinking** in purple next to the blue working square.

## MCP and Skills

On the right, the **MCP · Skills** button counts the thread's MCP servers and skills, for example `MCP 3 · Skills 12`. When some servers aren't connected it shows how many are, for example `MCP 1/2`, and when some skills are turned off, how many are on (`Skills 10/12`). Its dot is the servers' health: green when every connection is healthy, amber when some are down but others are still connected, and red when none are connected. With no MCP servers, the dot is green while any skill is on. In a narrow bar only the dot shows. Click it for a menu with a row for each, which opens its drawer on the right.

## MCP Servers

The **MCP servers** row opens the MCP drawer, where you manage the servers without restarting the thread. The counts refresh when each turn ends. Press `Esc`, click the close button or click outside it to close it. If you close it during a browser sign-in, the sign-in carries on, and opening the drawer again shows how it went. Switching to another thread closes the drawer. The drawer only offers the controls the thread's agent supports:

- Each server shows where it comes from (for example user, project, plugin or claude.ai), its status and its tool count
- Click the tool count to list the server's tools. Tools the server marks as destructive or read-only are tagged
- An estimate of how much of the context window the server's tool definitions use, so you can see which servers are worth disconnecting. "loaded on demand" means the agent only loads the tools when it searches for them
- A failed server shows its error, with a button to copy it
- **Reconnect** restarts a connection. **Sign in** starts the browser sign-in for a server that needs it
- Threads on the same agent share its sign-ins. Once a server connects after you sign in or reconnect it, your other open threads on that agent reconnect it too, in the background. A thread in the middle of a turn waits for the turn to end
- **Refresh** reconnects every server that needs a sign-in or failed, in this thread and your other open threads on the same agent, then checks each server's status. Servers that are already connected are left alone, and so is one whose browser sign-in is still under way (for up to 3 minutes)
- **Disconnect** turns a server off, and **Connect** turns it back on. How long a disconnect lasts depends on the agent: hover the button to see. With Claude Agent it applies to the whole project, not just this thread, so new threads in the project also start without it

New servers are added from Settings → MCP servers (Tool shed).

Each server in the drawer shows a status dot:

| Color | Meaning |
|-------|---------|
| Green | Connected |
| Blue pulsing | Connecting |
| Amber | Needs authentication |
| Gray | Disabled (disconnected) |
| Red | Failed |

## Skills

The **Skills** row says how many skills the thread's agent can use and how many are on. Click it to open the Skills drawer on the right. **This thread** lists them, each with **Run** (a new thread that uses it now) and **Schedule**, and the rest in its **⋯** menu (or right-click the skill): **Edit SKILL.md**, **Open folder** (shows the skill's `SKILL.md` in Explorer), **Who can use it…** (below) and, for Claude Agent, **Disable**. A turned-off skill keeps **Enable** in view. **Scheduled** lists every project's schedules. The clock on a project's header in the sidebar opens Scheduled too, and **Skills** at the foot of the sidebar opens it too. The drawer keeps the keyboard inside it until you close it with `Esc` or **×**. To start a thread with a skill and your own instructions, type `/` in a new thread's message box or use **Skills** at its foot (see [Starting a Thread](getting-started.md#starting-a-thread)).

**This thread** puts skills in sections by where they live: **Project** (in the project, for anyone working on it), **Personal** (in your user folder, for all your projects) and **Plugin and built-in** (reported by the running agent, with no file to edit). Click a section's heading to fold it. The search box above them finds skills by name or description in every section, folded or not; `Esc` clears it before closing the drawer.

### Which agents, and which projects

Skills are folders with a `SKILL.md` file, a format every agent Grove Bench knows reads. Where a skill's folder is decides who has it:

| Folder | Agents | Projects |
|---|---|---|
| The project's `.claude/skills` | Claude Agent (every account), and Copilot and OpenCode | This one |
| The project's `.agents/skills` | Every agent | This one |
| `~/.claude/skills` | Your first Claude account, and OpenCode | All |
| Another Claude account's folder, such as `~/.claude-work/skills` | That account only | All |
| `~/.agents/skills` | Every agent | All |

Claude Agent doesn't read `.agents/skills`, so it finds a shared skill through a small link file in its own folder, with the same name and description, which tells it to read the shared one. Links are plain files, so they work in git for your whole team, with or without Grove Bench. In a Claude Agent thread Grove Bench keeps them up to date by itself each time the drawer opens: it adds missing ones (for a personal skill, in every Claude account's folder), updates ones whose skill's name or description changed, and removes ones to skills that were deleted. Only links Grove Bench made are touched, and a change to a project's shows in the Changes tab for you to commit.

Each skill's card says who can use it, such as **Claude only · This project** or **All agents · All my projects**. To change it, choose **Who can use it…** in its menu and pick:

- **Agents**: **Claude only** keeps it in Claude Agent's folder (for a personal skill, the thread's Claude account's own); **All agents** moves it to `.agents/skills` at the same level, leaving links. Only asked in a Claude Agent thread
- **Projects**: **All my projects** copies a project skill to your user folder: `~/.agents/skills` for all agents, or the Claude account's own folder for Claude only. The project keeps its copy for your team. A personal skill is in all your projects already

A line under the choices says what **Apply** will do. When a personal and a project skill have the same name, Claude Agent uses the personal one, so a Claude Agent thread lists that one; other agents' threads list the project's. **Add skill** saves a new skill in `.agents/skills`, in the project or, for a personal one, in your home folder, with its links. Saving a project skill, or changing who can use one, changes files in the project, which show in the Changes tab. For Claude Agent you can also turn skills off and get suggestions from your past threads.

### Editing a skill

**Edit SKILL.md** opens the skill's `SKILL.md` in the drawer as plain text, frontmatter included, so settings the Add skill form doesn't have (such as `allowed-tools`) stay as they are. **Save** (`Ctrl+S`) writes it back, keeping the file's line endings. For a shared skill it edits the file in `.agents/skills` and updates its links. Save refuses if the file changed after you opened it (**Reload** shows the new version, dropping your changes) or if the text changes the skill's `name`, since schedules, links and turned-off skills go by it. **Open in editor** opens the file in VS Code, Cursor or your default app instead. Leaving the editor, switching tab or closing the drawer with unsaved changes asks first.

## Context

**Context N%** and a bar of pixel blocks show how much of the agent's context window has been used. Each block is 20% (5% in the popup), and the block the usage is partway through shows dimmed. In a narrower bar the word **Context** goes first, then the blocks, leaving the percentage. Context is what the agent can hold in mind at once: your messages, its replies, files it read and command output. Near the limit, Claude Code clears old tool output first, then summarises the thread, so details from early on can be lost ([How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up)).

| Usage | Color | Meaning |
|-------|-------|---------|
| 0–40% | Green | Plenty of room |
| 40–70% | Yellow | Getting full |
| 70–85% | Amber | Running low |
| 85–100% | Red | Nearly full: the agent may start summarising older context |

Every filled block takes the colour. Tokens served from the prompt cache take up room like any others, so they count toward the percentage; the popup lists how many were read from or written to the cache.

Click the bar for details and two actions:

- **Summarise to free space** (`/compact`): replaces the earlier messages with a summary, so the agent has room to keep going. It keeps the gist, not every detail. Shown only for agents that can do it (Claude Agent, or an agent that lists a `compact` command)
- **Start fresh…** (`/clear`): clears the thread and the agent's memory of it. It asks you to confirm first. Your files are not changed.

With **Show grove characters** on (Settings → General (The grove)), a strip of pixel grove also runs along the top of the status bar. It starts with a few small plants and fills in as the thread uses its context window: grass and saplings first, then bushes and trees, until it is a full grove at 100%. Its leaves change with the bar's colour: summer green while there is plenty of room, then late summer, autumn, and rust when the context is nearly full. They turn a plant at a time in the run-up to each change, so by the time the bar changes colour the whole grove has. After `/compact` or `/clear` it thins out and turns green again. Each thread grows its own grove, with the plants in their own random places. In the open thread you can watch it happen: new plants sprout one after another and rise out of the ground (unless your system is set to reduce motion).

## Rate Limiting

If the agent nears the API rate limit, a small amber mark appears on the **Activity** button, and its popup says how much of the limit is used and when it resets. Once requests are throttled, the button says **Rate limited** in red.

## Background Tasks

When the agent runs background tasks (subagents or long commands), the **Activity** popup lists them with their status, and the button says **Background** while one runs after the turn ends:

| Color | Meaning |
|-------|---------|
| Blue pulsing | Task running |
| Green | Task completed |
| Red | Task failed |

The square button beside a running task stops it, and **×** dismisses a finished one. Click a subagent's name in the list to open its thread, the same panel its line in the Thread tab opens.
