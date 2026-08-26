# Status Bar

The status bar sits at the top of the workspace area and displays real-time information about the active session.

## Model & Mode

The left side shows the current Claude model (click to switch) and operating mode:

| Mode | Color | Description |
|------|-------|-------------|
| **Code** | Blue | Default mode — the agent reads and writes code freely |
| **Plan** | Yellow | Planning mode — the agent explores and plans but doesn't edit files |
| **Edit** | Purple | Accept-edits mode — you must approve each file change |

Click the mode badge or press `Alt+M` to cycle between modes.

## Thinking Level

A **thinking** control sets how much extended thinking (deeper reasoning) the agent uses. Press `Alt+T` or click the badge to cycle through the levels:

| Level | Meaning |
|-------|---------|
| **Off** | No extended thinking |
| **Low** | Brief reasoning on hard steps |
| **Med** | Moderate reasoning budget |
| **High** | Provider default / maximum reasoning |

When thinking is active, a purple pulsing dot appears while the agent reasons.

## MCP Servers

When the agent has MCP servers configured, an **MCP** badge shows how many are connected (red dot if any connection is down). Click it to see each server's live status and tool count, and to **Reconnect**, **Disconnect**, or re-**Connect** individual servers without restarting the session.

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

## Dev Servers

If a dev server is detected (e.g. `npm start`, `vite`), its status appears:

| Color | Meaning |
|-------|---------|
| Green | Dev server running |
| Yellow pulsing | Dev server starting |
| Red | Dev server error |

## Background Tasks

When the agent runs background tasks (subagents), their status is shown:

| Color | Meaning |
|-------|---------|
| Blue pulsing | Task running |
| Green | Task completed |
| Red | Task failed |

## MCP Servers

If MCP (Model Context Protocol) servers are connected, each shows a status dot:

| Color | Meaning |
|-------|---------|
| Green | Connected |
| Red | Disconnected |
