# Session States & Colors

Each agent session displays a colored dot in the sidebar indicating its current state. The dot color and animation tell you what the session is doing at a glance.

## Session Status

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🟢 Green | None | **Ready** | Session is active and idle, waiting for input |
| 🟡 Yellow | Pulsing | **Starting** | Session is initializing |
| 🟡 Yellow | Pulsing | **Installing** | Dependencies are being installed |
| ⚫ Gray | None | **Stopped** | Session has been stopped |
| 🔴 Red | None | **Error** | Session encountered an error |
| ⚫ Muted | Pulsing | **Destroying** | Session is being cleaned up |

## Agent Activity Indicators

When a session is running, the dot may change to reflect what the agent is currently doing:

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🔵 Blue | Pulsing | **Working** | The agent is processing, reading files, or generating a response |
| 🟠 Amber | Pulsing | **Pending Permission** | The agent is waiting for you to approve or deny an action |

## What to Do

- **Green dot** — The agent is idle and ready for your next instruction.
- **Pulsing blue** — The agent is working. Wait for it to finish or check the Activity tab for details.
- **Pulsing amber** — Action required! Switch to this session and review the permission request in the Activity tab.
- **Red dot** — Something went wrong. Check the Activity tab for error details. You may need to restart the session.
- **Gray dot** — The session is stopped. You can send a new message to restart it.
