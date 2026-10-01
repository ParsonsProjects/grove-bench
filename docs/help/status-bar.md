# Status Bar

The status bar sits at the bottom of the workspace, just above the prompt, and shows live information about the open conversation.

In a narrow window the bar drops its extras so the agent settings, the activity, the branch and the context meter keep their room. As it narrows it drops, in order: the last turn's cost and duration, the project name (the branch's tooltip still names it), then **Keys** (the same list is under Keyboard Shortcuts in Help, `F1`) and the **MCP** and **Skills** badges. The MCP badge stays while a server is down.

## Agent Settings

The left side is a single **Agent settings** control. The first line is the model and the mode, for example `Opus 5.5 · Ask`; a long model name is cut short, and hovering shows it in full. The second line is the agent, followed by any control that is off its default, for example `Claude Agent · Low · Fast`. Click it to open a popup with one column per setting: **Agent**, **Model**, and each control the provider declares for that model (Mode, Effort, Thinking, Speed). Pick an option in any column; the change applies immediately. A line under the columns says what the current mode does, or what any option you point at or tab to does. **Done**, `Esc`, or clicking outside closes the popup. A conversation keeps the agent it started with, because its history is stored by that agent and only that agent can pick it up again. Picking another agent starts a new conversation with it in the same project, as a draft, and leaves this one as it is. In a draft (see [Getting started](getting-started.md#starting-a-conversation)) every column can still change, the agent included.

### Usage

Under the agent, the popup shows your **plan usage**: one bar per rate-limit window (for example 5-hour and Weekly, plus per-model weekly windows when your plan has them) with the percentage used and when it resets. It refreshes when you open the popup and after each turn, and live rate-limit headers keep it current in between. Usage is per sign-in, so every conversation on the same account shows the same numbers. API-key and third-party sign-ins have no plan limits, and the popup says so instead.

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

Read-safe and Auto differ in who decides: Read-safe uses a fixed allowlist inside Grove and asks you about everything else, so nothing unexpected ever runs unprompted. Auto hands the decision to Claude's classifier and rarely prompts, so the agent can run tests, commit and so on without you, at the cost of a model making the call.

The Mode, Effort, Thinking and Speed columns are declared by the agent provider for the model you have selected, so the options you see are exactly the ones that provider and model support. Switching models can add or remove a column (for example, Fast speed is only offered on models that support it) and resets any choice the new model does not offer to its default.

## Activity

Next to the agent settings, the bar says what the agent is doing: **idle**, **thinking**, **writing**, or the tool it is running and for how long. **waiting for you** (amber) means a permission prompt or a question is waiting for your answer in the Thread tab; it shows over whatever the agent was doing. Underneath are any rate-limit warning, pending tools, background tasks and memory compaction. Click a pending tool or background task count for details.

## Last turn

When the bar is wide enough, it shows how long the last turn took. With an API key sign-in it also shows what the turn cost, estimated at list price (hover for the exact figure). On a plan such as Pro or Max the cost is left out, because turns count toward the plan's limits rather than a bill; **Usage** in Agent settings shows how much of the plan you've used.

## Project and Branch

The branch area shows the conversation's project and branch, for example `grove-bench / feat/login`. The branch has a dashed underline while you can click it. Under it are the sync state (commits to push or pull) and the pull request. Click `↑N` to push those commits. If a push fails, from here or from the Changes tab, **push failed** appears: click it to see the error, copy it, **Retry** the push or **Dismiss** the note. It also goes away by itself once nothing is left to push.

Click the branch name to switch branches. Type to filter local and remote branches, then click one or press `Enter`. If the name you type doesn't exist yet, **Create branch** makes it from the current commit and switches to it.

- A branch that only exists on the remote gets a local branch that tracks it.
- Switching is refused while the checkout has uncommitted changes or untracked files, so commit, stash or remove them first. Creating a new branch is still allowed: no files change, so your uncommitted work comes along.
- A branch can only be checked out in one place. A branch in use by another worktree (your project folder included) can't be picked.
- The branch name can't be clicked while the agent is working. Switch once its turn ends.
- Conversations that share a checkout move together. For a direct conversation that checkout is your project folder, so your editor sees the switch too.
- Closing a conversation with "Also delete the branch" never deletes the project's default branch, even if the conversation switched onto it.

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

## Thinking

On most models a **Thinking** control switches extended thinking **On** (the model decides when and how much to think, and Effort sets how much) or **Off**. Pick it in the Agent settings popup, or press `Alt+T` to toggle it.

- Opus 5.5 and Fable 5 always think, so they show no Thinking control. Use a lower Effort to make them faster.
- Haiku 4.5 has no Effort setting, so its Thinking control keeps fixed levels: **Off**, **Low**, **Medium**, and **High**.

When thinking is active, a purple pulsing dot appears while the agent reasons.

## MCP Servers

When the agent has MCP servers configured, an **MCP** badge shows how many are configured. The dot is green when every connection is healthy, orange when some are down but others are still connected, and red when none are connected. It refreshes when each turn ends. Click it to manage the servers without restarting the conversation. The popover only offers the controls the conversation's agent supports:

- Each server shows where it comes from (for example user, project, plugin or claude.ai), its status and its tool count
- Click the tool count to list the server's tools. Tools the server marks as destructive or read-only are tagged
- An estimate of how much of the context window the server's tool definitions use, so you can see which servers are worth disconnecting. "loaded on demand" means the agent only loads the tools when it searches for them
- A failed server shows its error, with a button to copy it
- **Reconnect** restarts a connection. **Sign in** starts the browser sign-in for a server that needs it
- **Disconnect** turns a server off, and **Connect** turns it back on. How long a disconnect lasts depends on the agent: hover the button to see. With Claude Agent it applies to the whole project, not just this conversation, so new conversations in the project also start without it

New servers are added from Settings → Tool shed (MCP servers).

Each server in the popover shows a status dot:

| Color | Meaning |
|-------|---------|
| Green | Connected |
| Yellow pulsing | Connecting |
| Yellow | Needs authentication |
| Gray | Disabled (disconnected) |
| Red | Failed |

## Context

**Context N%** and a colored bar show how much of the agent's context window has been used. Context is what the agent can hold in mind at once: your messages, its replies, files it read and command output. Near the limit, Claude Code clears old tool output first, then summarises the conversation, so details from early on can be lost ([How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up)).

| Usage | Color | Meaning |
|-------|-------|---------|
| 0–40% | Green | Plenty of room |
| 40–70% | Yellow | Getting full |
| 70–85% | Orange | Running low |
| 85–100% | Red | Nearly full: the agent may start summarising older context |

The whole bar takes the colour. Tokens served from the prompt cache take up room like any others, so they count toward the percentage; the popup lists how many were read from or written to the cache.

Click the bar for details and two actions:

- **Summarise to free space** (`/compact`): replaces the earlier messages with a summary, so the agent has room to keep going. It keeps the gist, not every detail.
- **Start fresh…** (`/clear`): clears the conversation and the agent's memory of it. It asks you to confirm first. Your files are not changed.

With **Show grove characters** on (Settings → The grove (General)), a strip of pixel grove also runs along the top of the status bar. It starts as bare ground and fills in as the conversation uses its context window: grass and saplings first, then bushes and trees, until it is a full grove at 100%. After `/compact` or `/clear` it thins out again. Each conversation grows its own grove, with the plants in their own random places. In the open conversation you can watch it happen: new plants sprout one after another and rise out of the ground (unless your system is set to reduce motion).

## Rate Limiting

If the agent hits API rate limits, an indicator appears:

| Color | Meaning |
|-------|---------|
| Yellow pulsing | Approaching rate limit |
| Red pulsing | Rate limited — requests are being throttled |

## Background Tasks

When the agent runs background tasks (subagents), their status is shown:

| Color | Meaning |
|-------|---------|
| Blue pulsing | Task running |
| Green | Task completed |
| Red | Task failed |

