# Agent monitor

A window that shows what every agent in Grove Bench is running: each thread in every project, its subagents and background shells, the tool each is on right now, and the processes under each agent. You can stop what can be stopped from it.

Today this is spread out and per thread: the status bar's Activity popup lists the tools running and the background tasks (`StatusBarActivity.svelte`), the sidebar counts a thread's background shells, the Subagent panel shows one subagent, and the process tree is only sampled for the health line in `performance.log`. Nothing shows all of it at once.

## The mockup

`agent-monitor.html` on the dev server (`npm start`, then open `/agent-monitor.html`), code in `src/renderer/agent-monitor-mockup/`. Made-up data that moves every second, built from the UI kit so it looks like the app. Like the UI kit page, it is never bundled into the app.

- **Agents view.** Threads grouped by project, with their subagents and background shells or monitors under them. Columns: what it is doing now (tool and target, Thinking, or what it is waiting for you on), how long, tokens, memory. **Running** hides threads with nothing running or waiting; **All threads** shows the rest.
- **Processes view.** Each agent's process tree under the agent host: executable, PID, thread, memory, how long it has run.
- **Side pane.** The selected thread, subagent, shell or process: what it is doing, what it was asked (subagents), recent tool calls, its processes, and its actions.
- **Actions.** Interrupt a thread's turn. Stop a background subagent, shell or monitor. End a process and what it started (asks first; never the agent itself). Open thread, which in the app would bring the main window forward on it.
- Filter box across thread names, tools, files, subagents and processes.

## Where the real data would come from

| What | Source today |
|---|---|
| Thread state, current tool, tool target | The agent's event stream; the renderer works it out in `messageStore` (`getActivity`, `getPendingTools`, `src/renderer/stores/messages.svelte.ts`) |
| Subagents and their tool calls | Claude Code's Agent calls and their child events (`PendingTool.inSubagent`, `subagentCall`); background ones as tasks (`backgroundTaskStore`) |
| Background shells and monitors | The agent's live task list. Main already keeps it per thread (`ThreadTurnState.backgroundTasks`, `src/shared/types.ts`) |
| Process tree, memory, age | `process-memory.ts`: typeperf in the agent host, one sample of PID, parent, private bytes and age |
| Stop a background task | `SESSION_STOP_TASK` (`ipc.ts`) to `stopTask` (`adapters/claude-code.ts`) |
| Interrupt a turn | The existing session interrupt |
| Kill a process tree | `taskkillWith` in `process-tree-kill.ts` |

## What the real data can't do (the mockup says so where it matters)

1. **No link from a tool call to its process.** Neither a Bash call nor a background task carries a PID (`LiveBackgroundTask` has none), so processes can only be grouped by agent, not by tool call, subagent or shell. The mockup shows "shared" memory for subagents and "?" for shells for this reason.
2. **No command lines.** typeperf gives executables only, and PowerShell is ruled out because antivirus flags it (see the comment at the top of `process-memory.ts`). Two `node.exe` processes look the same.
3. **No CPU.** The sample doesn't read a CPU counter. Adding one is possible but not checked yet: CPU use is a rate, so it may need two samples.
4. **Sampling cost.** The health line samples every 10 minutes (`HEALTH_MS`, `perf-health.ts`). A live monitor would want every few seconds, and each sample starts typeperf. It should only sample while the window is open, and the cost of each launch on Windows needs measuring first.
5. **Foreground subagents can't be stopped alone.** `stopTask` stops background tasks only (comment in `adapters/claude-code.ts`). One the turn waits on stops when the turn is interrupted; the mockup's Stop is disabled on those and says why.
6. **ACP agents don't report subagents** (Gemini CLI, Copilot CLI, OpenCode). The tree is Claude Code only for now (see `adapters/acp/opencode.ts` and the OpenCode entry in TODO.md).
7. **Windows only.** Process sampling is Windows only, like the app.

## Decisions before building it

- **Where the state lives.** A second window is a second renderer, so it can't read the main window's stores. Either main builds a small per-thread summary from the events it already forwards and sends it to the monitor, or main relays the main window's stores. The first is cleaner; keeping the reducing code in `src/shared` would let both windows agree on what "running" means.
- **A narrower preload.** The main preload can reach the shell and PTYs. The monitor only needs to read the summary and send stop, interrupt, end process and focus thread, so it should get its own small bridge.
- **Ending processes safely.** Only offer PIDs from the latest sample that sit under a thread's agent, and check the PID still has the same start time before killing it, since Windows reuses PIDs.
- **Build entry.** The renderer build only bundles `index.html` today; the window needs its page added to the Vite inputs.

## Next steps

1. Agree the layout and actions on the mockup.
2. Measure a typeperf sample's cost on Windows, and try a CPU counter.
3. Build the main-process summary and the window, Agents view first (it needs no new data), then Processes.
