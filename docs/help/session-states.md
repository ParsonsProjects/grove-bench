# Thread States & Colors

Each thread displays a colored dot in the sidebar indicating its current state. The colors match the filter chips at the top of the sidebar, so a color always means the same thing:

- **Amber**: needs you
- **Blue**: working (starting up counts)
- **Green**: finished a turn you haven't looked at yet
- **Red**: something went wrong
- **Gray**: quiet, nothing to do

With **Show grove characters** on, a small pixel agent shows the state instead, wearing the same color. Its pose tells the gray states apart: sitting when ready, asleep when sleeping or closed. The plain dot does the same with a hollow square for sleeping and closed. Hover either one to see the state's name.

## Thread Status

| Color | Animation | State | Description |
|-------|-----------|-------|-------------|
| 🟠 Amber | Pulsing | **Waiting for you** | The agent is waiting for you to approve an action or answer a question |
| 🔵 Blue | Pulsing | **Working** | The agent is processing, reading files, or generating a response |
| 🔵 Blue | Pulsing | **Starting** | Thread is initializing |
| 🔵 Blue | Pulsing | **Installing** | Dependencies are being installed |
| 🟢 Green | Flashing | **Finished a turn** | The agent finished while you were in another thread |
| 🔴 Red | None | **Error** | Thread encountered an error |
| ⚪ Light gray | None | **Ready** | Thread is active and idle, waiting for input |
| ⚫ Gray, hollow | None | **Sleeping** | Idle for a while, so its agent was shut down to save memory and CPU, or still open from when Grove Bench last closed. Still open; wakes when you open it |
| ⚫ Gray, hollow | None | **Closed** | You closed the thread |
| ⚫ Muted | Pulsing | **Deleting** | Thread is being removed |

If your system is set to reduce motion, the dots stay still.

## What to Do

- **Amber**: Action required. Switch to this thread and answer the request in the Thread tab.
- **Blue**: The agent is working. Wait for it to finish or check the Thread tab for details.
- **Green**: Open the thread to see what the agent did.
- **Red**: Something went wrong. Check the Thread tab for error details. You may need to restart the thread.
- **Light gray**: The agent is idle and ready for your next instruction.
- **Hollow gray, sleeping**: The thread is asleep. Open it or send it a message and its agent starts again where it left off, with the same mode and "always allow" choices. Its terminal and anything running there were left alone. The agent's page in the Preview tab was closed; your page stays. Set how long a thread waits before sleeping in Settings → Background work (Tending).
- **Hollow gray, closed**: You closed the thread. Its agent, background commands and terminal have been shut down, including any dev servers they started. Open it again (`Ctrl+R` finds it) and its agent starts again.
