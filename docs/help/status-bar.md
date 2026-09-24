# Status Bar

The status bar sits at the top of the workspace area and displays real-time information about the active conversation.

## Agent Settings

The left side is a single **Agent settings** control: the agent on the first line, and on the second the model, the mode, and any control that is off its default (for example `Opus 5.5 · Code` normally, or `Opus 5.5 · Plan · Low · Fast` after changes). Click it to open a popup with one column per setting: **Agent**, **Model**, and each control the provider declares for that model (Mode, Effort, Thinking, Speed). Pick an option in any column; the change applies immediately. **Done**, `Esc`, or clicking outside closes the popup. The agent itself is fixed when a conversation is created, so other agents are listed but not selectable.

### Usage

Under the agent, the popup shows your **plan usage**: one bar per rate-limit window (for example 5-hour and Weekly, plus per-model weekly windows when your plan has them) with the percentage used and when it resets. It refreshes when you open the popup and after each turn, and live rate-limit headers keep it current in between. Usage is per sign-in, so every conversation on the same account shows the same numbers. API-key and third-party sign-ins have no plan limits, and the popup says so instead.

### Mode

The operating mode controls how much the agent may do without asking:

| Mode | Color | Description |
|------|-------|-------------|
| **Code** | Blue | Default mode — the agent asks before edits and non-trivial commands |
| **Plan** | Yellow | Planning mode — the agent explores and plans but doesn't edit files |
| **Edit** | Purple | Accept-edits mode — file edits inside the worktree are applied without asking; commands still prompt |
| **Auto** | Cyan | Claude Code's native auto mode — a classifier model reviews each action instead of you. Read-only actions and in-worktree edits are approved; risky or out-of-scope actions (force push, `curl \| bash`, secrets, mass deletion) are blocked and shown as a status line rather than prompted. Not offered on models that don't support it (Haiku) |
| **Read-safe** | Green | Grove's own mode — edits and recognised read-only commands (file reads, `git status`, `git log`, `ls`, `grep`, …) run without asking. Anything that writes, reaches outside the worktree, touches the network, or isn't on the allowlist still prompts. A sandbox confines writes to the worktree as a backstop |

Click the mode badge or press `Alt+M` to cycle between modes. The first four are Claude Code's own modes. Read-safe is Grove Bench's, so it sits below a divider headed "Grove Bench" in the mode list and in Settings.

Read-safe and Auto differ in who decides: Read-safe uses a fixed allowlist inside Grove and asks you about everything else, so nothing unexpected ever runs unprompted. Auto hands the decision to Claude's classifier and rarely prompts, so the agent can run tests, commit and so on without you, at the cost of a model making the call.

The mode, effort, thinking, and speed badges are declared by the agent provider for the model you have selected, so the options you see are exactly the ones that provider and model support. Switching models can add or remove a badge (for example, Fast speed is only offered on models that support it) and resets any choice the new model does not offer to its default.

## Speed

On models that support it, a **Speed** badge toggles between **Standard** and **Fast** output. Fast keeps the same model but returns responses more quickly.

## Effort

An **Effort** control sets how much the agent reasons before it acts. Higher effort means more thorough work, but it takes longer and uses your plan limits faster. Press `Alt+E` or click the badge to cycle through the levels the current model offers:

| Level | Meaning |
|-------|---------|
| **Low** | Fastest and cheapest; brief reasoning |
| **Medium** | Balanced speed and depth |
| **High** | Deep reasoning |
| **Extra** | Deeper than High; suits long coding and agentic work |
| **Max** | Uncapped reasoning; slow and token-hungry, for the hardest tasks |

Each model starts on its own default: **Medium** for Opus 5.5, **Extra** for Opus 4.7, and **High** for the others. Opus 4.6 and Sonnet 4.6 don't offer Extra. Haiku 4.5 has no effort setting.

## Thinking

On most models a **Thinking** control switches extended thinking **On** (the model decides when and how much to think, and Effort sets how much) or **Off**. Press `Alt+T` or click the badge to toggle it.

- Opus 5.5 and Fable 5 always think, so they show no Thinking control. Use a lower Effort to make them faster.
- Haiku 4.5 has no Effort setting, so its Thinking control keeps fixed levels: **Off**, **Low**, **Medium**, and **High**.

When thinking is active, a purple pulsing dot appears while the agent reasons.

## MCP Servers

When the agent has MCP servers configured, an **MCP** badge shows how many are configured. The dot is green when every connection is healthy, orange when some are down but others are still connected, and red when none are connected. Click it to see each server's live status and tool count, and to **Reconnect**, **Disconnect**, or re-**Connect** individual servers without restarting the conversation. New servers are added from Settings → MCP.

Each server in the popover shows a status dot:

| Color | Meaning |
|-------|---------|
| Green | Connected |
| Yellow pulsing | Connecting |
| Yellow | Needs authentication |
| Gray | Disabled (disconnected) |
| Red | Failed |

## Context Window

A colored bar shows how much of the agent's context window has been used:

| Usage | Color | Meaning |
|-------|-------|---------|
| 0–40% | Green | Plenty of room |
| 40–70% | Yellow | Getting full |
| 70–85% | Orange | Running low |
| 85–100% | Red | Nearly full — the agent may start compacting older context |

A blue segment within the bar represents cached/reusable context.

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

