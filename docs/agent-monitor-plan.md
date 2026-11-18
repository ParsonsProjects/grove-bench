# Agent monitor

A window that shows what every agent in Grove Bench is running: each thread in every project, its subagents and background shells, the tool each is on right now, and the processes under each agent. You can stop what can be stopped from it.

Today this is spread out and per thread: the status bar's Activity popup lists the tools running and the background tasks (`StatusBarActivity.svelte`), the sidebar counts a thread's background shells, the Subagent panel shows one subagent, and the process tree is only sampled for the health line in `performance.log`. Nothing shows all of it at once.

## The mockup

Two pages on the dev server (`npm start`), code in `src/renderer/agent-monitor-mockup/`. Made-up data that moves every second, built from the UI kit so it looks like the app. Like the UI kit page, neither is bundled into the app.

- `/agent-monitor.html`: the monitor as a window of its own.
- `/agent-monitor-dialog.html`: the same monitor as a dialog over the demo app, with the trigger that opens it (below). It starts closed; add `?open` to start with it open. **Open thread** really switches the app to that thread and closes the dialog. **Ctrl+Shift+A** (proposed; nothing in the app uses it) opens and closes it, and it opens with the cursor in the filter box. The made-up threads follow the demo's states, so the dialog's totals match the sidebar's.

- **Agents view.** Threads grouped by project, with their subagents and background shells or monitors under them. Columns: what it is doing now (tool and target, Thinking, or what it is waiting for you on), how long, tokens, memory. **Running** hides threads with nothing running or waiting; **All threads** shows the rest.
- **Processes view.** Each agent's process tree under the agent host: executable, PID, thread, memory, how long it has run.
- **Side pane.** The selected thread, subagent, shell or process: what it is doing, what it was asked (subagents), recent tool calls, its processes, and its actions.
- **Actions.** Interrupt a thread's turn. Stop a background subagent, shell or monitor. End a process and what it started (asks first; never the agent itself). Open thread, which in the app would bring the main window forward on it.
- Filter box across thread names, tools, files, subagents and processes.

### The trigger

**In the title bar**, before Help (`MonitorTrigger.svelte`): an activity icon and the counts, amber for threads that need you, blue for those working. It is always in view, sidebar open or collapsed, and shows the counts without hovering. Its tooltip gives the counts and the shortcut.

It counts threads the way the sidebar's filter chips do (`sessionSpriteState`, `triageForSprite`, `triageCounts`) and draws them with the chips' marks (`AttentionCounts`), so it can't disagree with the chips.

Decided against:

- **An icon in the sidebar's footer tools** (mocked, then dropped): a sixth icon in a busy footer, and it needs a hover to give the counts.
- **The filter chips** (Needs you, Working, Unread, Idle, To do): clicking one already filters the thread list (`Sidebar.svelte`, `lib/session-triage.ts`).

On the mockup page the trigger is put into the demo app from outside (`inject-trigger.ts`), so the app's code is unchanged. In the app it would go in `TitleBar.svelte`.

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
6. **ACP agents don't report subagents** (Gemini CLI, Copilot CLI, OpenCode), so the tree is Claude Code only for now. Partly Grove, partly the providers:
   - ACP only has a draft for it ([Subagent Sessions RFD](https://agentclientprotocol.com/rfds/subagents)): each subagent gets its own session, announced with `subagent_update`, and a client opts in with `clientCapabilities.subagents`. Grove's ACP client doesn't implement it (`adapters/acp/protocol.ts` has no `subagent_update` and no parent on tool calls). The Claude and Codex ACP adapters are the only agents found sending it.
   - OpenCode: Grove turns its subagents off (`task: 'deny'`, `adapters/acp/opencode.ts`) because OpenCode doesn't send a subagent's permission requests over ACP, so one that asks hangs the turn. An upstream bug.
   - Gemini CLI: has subagents (v0.38.1, April 2026), but no sign it sends subagent sessions. Another client reports a subagent arrives as one `invoke_agent` tool call, so in Grove it is probably one plain tool call. Not checked on a real run; recognising it as a subagent row (without its inner calls) would be a cheap step.
   - Copilot CLI: has subagents and ACP (public preview), nothing found on whether ACP shows them.
7. **Windows only.** Process sampling is Windows only, like the app.

## Decisions before building it

- **Dialog or window.** As a dialog in the main window it reads the stores that window already keeps (`messageStore`, `backgroundTaskStore`), so the Agents view needs no new plumbing, and Open thread is a store change. But it is modal: it covers the app, so it is for a quick look and a jump, not for watching while you work in a thread. A window can stay open beside the app or on another screen, at the cost of the data plumbing below.
- **Where a window's state comes from.** A second window is its own renderer process, so it can't share the main window's stores in memory, though the two can message each other (through main, or over a MessagePort main sets up). Main already sends every agent event to the main window (`agent-session.ts`), so the simplest source is main sending them to the monitor too, with the reducing code in `src/shared` so both windows agree on what "running" means. Reading the saved history (`<userData>/worktrees/events/<id>.jsonl`) doesn't fit: the renderer can't read files (context isolation on, Node off), the log is written in batches every 250 ms, and the live events a monitor needs (`activity`, `tool_progress`) are never written (`shared/live-events.ts`).
- **A narrower preload.** The main preload can reach the shell and PTYs. The monitor only needs to read the summary and send stop, interrupt, end process and focus thread, so it should get its own small bridge.
- **Ending processes safely.** Only offer PIDs from the latest sample that sit under a thread's agent, and check the PID still has the same start time before killing it, since Windows reuses PIDs.
- **Build entry.** The renderer build only bundles `index.html` today; the window needs its page added to the Vite inputs.

## Next steps

1. Agree the layout and actions on the mockup.
2. Measure a typeperf sample's cost on Windows, and try a CPU counter.
3. Build the main-process summary and the window, Agents view first (it needs no new data), then Processes.
