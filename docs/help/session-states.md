# Conversation States & Colors

Each conversation displays a colored dot in the sidebar indicating its current state. The colors match the filter chips at the top of the sidebar, so a color always means the same thing:

- **Amber**: needs you
- **Blue**: working (starting up counts)
- **Green**: finished a turn you haven't looked at yet
- **Red**: something went wrong
- **Gray**: quiet, nothing to do

With **Show grove characters** on, a small pixel agent shows the state instead, wearing the same color. Its pose tells the gray states apart: sitting when ready, asleep when sleeping or stopped. The plain dot does the same with a hollow square for sleeping and stopped. Hover either one to see the state's name.

## Conversation Status

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🟠 Amber | Pulsing | **Waiting for you** | The agent is waiting for you to approve an action or answer a question |
| 🔵 Blue | Pulsing | **Working** | The agent is processing, reading files, or generating a response |
| 🔵 Blue | Pulsing | **Starting** | Conversation is initializing |
| 🔵 Blue | Pulsing | **Installing** | Dependencies are being installed |
| 🟢 Green | Flashing | **Finished a turn** | The agent finished while you were in another conversation |
| 🔴 Red | None | **Error** | Conversation encountered an error |
| ⚪ Light gray | None | **Ready** | Conversation is active and idle, waiting for input |
| ⚫ Gray, hollow | None | **Sleeping** | Idle for a while, so its agent was shut down to save memory and CPU. Still open; wakes when you open it |
| ⚫ Gray, hollow | None | **Stopped** | Conversation has been stopped |
| ⚫ Muted | Pulsing | **Deleting** | Conversation is being removed |

If your system is set to reduce motion, the dots stay still.

## What to Do

- **Amber**: Action required. Switch to this conversation and answer the request in the Thread tab.
- **Blue**: The agent is working. Wait for it to finish or check the Thread tab for details.
- **Green**: Open the conversation to see what the agent did.
- **Red**: Something went wrong. Check the Thread tab for error details. You may need to restart the conversation.
- **Light gray**: The agent is idle and ready for your next instruction.
- **Hollow gray, sleeping**: The conversation is asleep. Open it or send it a message and its agent starts again where it left off, with the same mode and "always allow" choices. Its terminal and anything running there were left alone. The agent's page in the Preview tab was closed; your page stays. Set how long a conversation waits before sleeping in Settings → Background work.
- **Hollow gray, stopped**: The conversation is stopped. Its agent, background commands and terminal have been shut down, including any dev servers they started. You can send a new message to restart it.
