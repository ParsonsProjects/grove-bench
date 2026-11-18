# Agent Monitor

The agent monitor shows what every thread is running, in every project, in one place: what each thread's agent is doing now, the subagents it has started, and the shells and monitors it left running in the background. From it you can stop any of them, or jump to the thread.

## Opening it

Click the activity counts in the title bar, just left of Help (**?**), or press `Ctrl+Shift+A`. Press `Esc`, the **✕** or `Ctrl+Shift+A` again to close it.

The counts in the title bar show how many threads need you (amber) and how many are working (blue). They are counted the same way as the **Needs you** and **Working** filters in the sidebar, so the two always agree. Hover them for the numbers in words.

## What it shows

Threads are grouped by project. Each row says what it is doing now:

- A tool and what it runs on, in yellow, such as **Bash** `npm test`, with how long it has been running.
- **Thinking**, **Writing** or **Working**.
- **Needs you** and what the agent is waiting for, such as "Wants to edit a file".
- When nothing runs, the thread's state, such as **Ready** or **Sleeping**. See [Thread states & colors](session-states.md).

Under a thread are its running **subagents** (with their kind, such as Explore, and what they were asked to do) and its **shells** and **monitors**: commands the agent left running after its turn, such as a dev server or a watch on a CI run.

**Running** lists only threads with something running or waiting on you. **All threads** lists every open thread. Closed threads aren't listed: their agents have stopped. The filter box narrows the list to threads, tools, files, subagents or shells that match what you type. It has the cursor when the monitor opens.

Click a row to see more on the right:

- **A thread:** what it is doing, its subagents and background commands, and its last few tool calls.
- **A subagent:** what it was asked, the tool it is running, its recent tool calls, and for a background one its tokens and how long it has run.
- **A shell or monitor:** the command it runs.

The monitor updates every second while it is open.

## Stopping things

The **■** at the end of a row stops it:

- **A thread:** interrupts its turn, as the composer's Stop button does. The agent stays up for your next message. Background subagents, shells and monitors keep running.
- **A background subagent, shell or monitor:** stops just that one.
- **A subagent the turn is waiting on:** can't be stopped on its own, so its **■** is greyed out. Interrupt the turn to stop it.

## Jumping to a thread

**Open thread** brings the thread up on its Thread tab and closes the monitor. **Answer in the thread** does the same for a thread waiting on you. For a subagent, **Open its thread** also opens the subagent's own thread beside it, as clicking its Agent call does.

## Limits

- Subagents show for Claude Code threads. Other agents (Gemini CLI, GitHub Copilot CLI, OpenCode) don't report subagents to Grove Bench, so for them the monitor shows the thread's own work only.
- The monitor shows what the agents report, not the processes on your computer. It can't yet show how much memory or CPU each agent uses.
