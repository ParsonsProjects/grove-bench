# Agent monitor

A dialog that shows what every agent in Grove Bench is running: each thread in every project, its subagents and background shells, and the tool each is on right now. You can stop what can be stopped from it, and jump to any thread. Help page: `docs/help/agent-monitor.md`.

Before it, this was spread out and per thread: the status bar's Activity popup lists the tools running and the background tasks (`StatusBarActivity.svelte`), the sidebar counts a thread's background shells, the Subagent panel shows one subagent, and the process tree is only sampled for the health line in `performance.log`.

## Built: the Agents view

- **Opens** from the title bar, before Help (`AgentMonitorTrigger.svelte` in `TitleBar.svelte`), or with **Ctrl+Shift+A** (`App.svelte`). The trigger shows the counts of threads that need you (amber) and are working (blue), counted the way the sidebar's filter chips do (`sessionSpriteState`, `triageForSprite`, `triageCounts`) and drawn with their marks (`AttentionCounts`), so the two can't disagree.
- **The dialog** (`AgentMonitorDialog.svelte`, loaded on first use): threads grouped by project, each with what it is doing now (the tool and its target, Thinking, Writing, or what it waits for you on), and under it its running subagents and the shells and monitors it left running. **Running** keeps threads with something running or waiting on you; **All threads** lists every open thread. Closed threads aren't listed. A filter box searches names, tools, files, subagents and shells, and has the cursor when the dialog opens.
- **The side pane** (`AgentMonitorDetail.svelte`): for a thread, what it is doing, its subagents and background commands, and its last tool calls; for a subagent, what it was asked, the tool it is running, its recent calls, and (background ones) its tokens and running time from its task; for a shell or monitor, its command.
- **Actions:** Interrupt a thread's turn (`lib/interrupt-turn.ts`, shared with the composer's Stop). Stop a background subagent, shell or monitor (`backgroundTaskStore.stop`, or straight through main for a shell the task store hasn't seen since a reload). A subagent the turn waits on can't be stopped alone, so its Stop is disabled and says why. **Open thread** switches the app to the thread on its Thread tab; **Open its thread** also docks the subagent's panel.

How it reads the data: `lib/agent-monitor.ts` builds the rows from one thread's state (pure, tested on its own); `stores/agentMonitor.svelte.ts` gathers that state from `messageStore`, `backgroundTaskStore`, `store` and `agentsStore`. The rows are a snapshot read again every second while the dialog is open, not a derivation: a derivation would walk every thread's messages again on every streamed word in any of them.

Subagents come from the thread's Agent calls. One whose call is still pending runs in the turn; one whose call has returned while its task still runs is in the background, and Stop goes to its task. A running agent task with no Agent call in the loaded messages (a workflow, a remote agent, or a subagent whose call is older than the loaded history page) is listed from its task alone, so nothing the title bar counts as working is missing; it has no thread of its own to open. The dialog's totals and its Running filter count threads the way the title bar and the chips do (`triageForSprite`). An interrupt (`interruptTurn`) leaves the calls a background subagent is running pending (`markSessionStopped`'s `keepBackground`), since the subagent works on.

## Not built yet

- **Processes and memory.** They need sampling in main (below). A clickable mockup of the Processes view, End process and the memory column was built while designing this and then removed so it wouldn't need upkeep; it is in the history of PR #304 (`git show 1683b4b:src/renderer/agent-monitor-mockup/MonitorView.svelte`).
- **Turn time and per-turn tokens for each thread.** The renderer keeps no turn start time; main would need to send one.
- **Subagents for ACP agents** (below).

## What the real data can't do

1. **No link from a tool call to its process.** Neither a Bash call nor a background task carries a PID (`LiveBackgroundTask` has none), so processes can only be grouped by agent, not by tool call, subagent or shell.
2. **No command lines.** typeperf gives executables only, and PowerShell is ruled out because antivirus flags it (see the comment at the top of `process-memory.ts`). Two `node.exe` processes look the same.
3. **No CPU.** The sample doesn't read a CPU counter. Adding one is possible but not checked yet: CPU use is a rate, so it may need two samples.
4. **Sampling cost.** The health line samples every 10 minutes (`HEALTH_MS`, `perf-health.ts`). A live view would want every few seconds, and each sample starts typeperf. It should only sample while the dialog is open, and the cost of each launch on Windows needs measuring first.
5. **Foreground subagents can't be stopped alone.** `stopTask` stops background tasks only (comment in `adapters/claude-code.ts`). One the turn waits on stops when the turn is interrupted.
6. **ACP agents don't report subagents** (Gemini CLI, Copilot CLI, OpenCode), so subagents show for Claude Code only. Partly Grove, partly the providers:
   - ACP only has a draft for it ([Subagent Sessions RFD](https://agentclientprotocol.com/rfds/subagents)): each subagent gets its own session, announced with `subagent_update`, and a client opts in with `clientCapabilities.subagents`. Grove's ACP client doesn't implement it (`adapters/acp/protocol.ts` has no `subagent_update` and no parent on tool calls). The Claude and Codex ACP adapters are the only agents found sending it.
   - OpenCode: Grove turns its subagents off (`task: 'deny'`, `adapters/acp/opencode.ts`) because OpenCode doesn't send a subagent's permission requests over ACP, so one that asks hangs the turn. An upstream bug.
   - Gemini CLI: has subagents (v0.38.1, April 2026), but no sign it sends subagent sessions. Another client reports a subagent arrives as one `invoke_agent` tool call, so in Grove it is probably one plain tool call. Not checked on a real run; recognising it as a subagent row (without its inner calls) would be a cheap step.
   - Copilot CLI: has subagents and ACP (public preview), nothing found on whether ACP shows them.
7. **Windows only.** Process sampling is Windows only, like the app.

## Decisions

- **A dialog, not a window.** In the main window it reads the stores that window already keeps, so the Agents view needed no new plumbing, and Open thread is a store change. It covers the app, so it is for a quick look and a jump, not for watching while you work in a thread.
- **The trigger in the title bar.** Always in view, sidebar open or collapsed, and it shows the counts without hovering. Decided against an icon in the sidebar's footer tools (mocked, then dropped: a sixth icon in a busy footer, and it needs a hover for the counts) and against the filter chips (clicking one already filters the thread list).

If it becomes a separate window later: a second window is its own renderer process, so it can't share the main window's stores in memory, though the two can message each other (through main, or over a MessagePort main sets up). Main already sends every agent event to the main window (`agent-session.ts`), so the simplest source is main sending them to the monitor too, reusing `lib/agent-monitor.ts`. Reading the saved history (`<userData>/worktrees/events/<id>.jsonl`) doesn't fit: the renderer can't read files (context isolation on, Node off), the log is written in batches every 250 ms, and the live events (`activity`, `tool_progress`) are never written (`shared/live-events.ts`). It would also want its own small preload, since the main one can reach the shell and PTYs.

For End process in the Processes view: only offer PIDs from the latest sample that sit under a thread's agent, and check the PID still has the same start time before killing it, since Windows reuses PIDs.

## Next steps

1. Try the Agents view on Windows with real Claude Code threads, subagents and dev servers.
2. Measure a typeperf sample's cost on Windows, and try a CPU counter.
3. Build the Processes view: sampling in main while the dialog is open, then End process.
4. Recognise Gemini CLI's subagent call as a subagent row; implement the ACP subagents draft once an agent Grove runs sends it.
