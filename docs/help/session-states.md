# Conversation States & Colors

Each conversation displays a colored dot in the sidebar indicating its current state. The dot color and animation tell you what the conversation is doing at a glance.

## Conversation Status

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🟢 Green | None | **Ready** | Conversation is active and idle, waiting for input |
| 🟡 Yellow | Pulsing | **Starting** | Conversation is initializing |
| 🟡 Yellow | Pulsing | **Installing** | Dependencies are being installed |
| 🟢 Dim green | None | **Sleeping** | Idle for a while, so its agent was shut down to save memory and CPU. Still open; wakes when you open it |
| ⚫ Gray | None | **Stopped** | Conversation has been stopped |
| 🔴 Red | None | **Error** | Conversation encountered an error |
| ⚫ Muted | Pulsing | **Destroying** | Conversation is being cleaned up |

## Agent Activity Indicators

When a conversation is running, the dot may change to reflect what the agent is currently doing:

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🔵 Blue | Pulsing | **Working** | The agent is processing, reading files, or generating a response |
| 🟠 Amber | Pulsing | **Pending Permission** | The agent is waiting for you to approve or deny an action |

## What to Do

- **Green dot** — The agent is idle and ready for your next instruction.
- **Pulsing blue** — The agent is working. Wait for it to finish or check the Activity tab for details.
- **Pulsing amber** — Action required! Switch to this conversation and review the permission request in the Activity tab.
- **Dim green dot**: The conversation is asleep. Open it or send it a message and its agent starts again where it left off, with the same mode and "always allow" choices. Its terminal and anything running there were left alone. Set how long a conversation waits before sleeping in Settings > General.
- **Red dot** — Something went wrong. Check the Activity tab for error details. You may need to restart the conversation.
- **Gray dot** — The conversation is stopped. Its agent, background commands and terminal have been shut down, including any dev servers they started. You can send a new message to restart it.
