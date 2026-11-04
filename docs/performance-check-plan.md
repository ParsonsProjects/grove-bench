# Performance check: plan

Grove already writes what it needs to explain slowness (`performance.log`:
freezes, launches, step timings, the 10-minute health line). Reading it takes
someone who knows the code. This feature reads it for the user and says what
is slow and what to do about it.

Scope, as agreed:

- **Shown both ways**: on demand (a **Check performance** button in Settings >
  Field notes) and as a notice when something is clearly wrong.
- **Fixed checks** built into the app: same input, same answer, no tokens.
- **Only what Grove causes**: Grove's own launches, writes, threads, agents and
  the installs its agents run. Other apps hogging the PC are out of scope,
  though the PC's totals (CPU, disk, free memory) are used to tell causes
  apart.

## How it works

`src/main/perf-check.ts` keeps the last hour in memory and runs the checks
over it. It reads numbers, never the log file:

| Input | From | New? |
|---|---|---|
| Each 10-minute period: freezes, agent output, Electron memory, agents' memory, the PC's CPU, disk and free memory, threads awake | `startHealthLog` (`perf-health.ts`), handed the same `HealthInput` it formats | small hook |
| Every hosted launch (not only slow ones), with finding and creating time | `process-host.ts` `received()` and `settle()` | counter |
| Event log writes over 1 s | `session-event-store.ts` `write()` | counter |
| Step timings (new thread, wake, resume) | `perf-steps.ts` | hook |
| Installs agents ran (`npm ci`, `npm install`, `pnpm install`, `yarn`, `bun install`) | agents' shell tool calls (`ToolView` kind `shell`), as `skill-suggestions.ts` already reads them | counter, the command text is never kept |
| Window freezes by cause (taskbar badge, notifications) | `freeze-log.ts` IPC timings | counter |

Each check is a pure function from that hour to zero or one finding, so the
tests feed it numbers taken from the 28 Oct to 3 Nov log.

A finding has a title, one or two sentences of evidence with the real
numbers, and one to three suggestions. Where a setting exists, a suggestion
can carry a button that opens it (or copies a path).

## Checks (v1)

Thresholds are starting points from the log we read; each is a named
constant so it can be tuned.

1. **Windows is slow to start Grove's programs.** At least 10 launches in the
   hour, 20% or more over 1 s, most of the time in creating the process, while
   the PC's CPU and disk were under 80% busy. Evidence: "811 of N launches took
   over 1 s, median 2.1 s, nearly all of it Windows creating the process."
   Suggests an antivirus exception, with the exact paths filled in: the
   worktree folder (`worktreeFolder` or `%APPDATA%\grove-bench\worktrees`),
   the claude.exe folder and git's folder. Copy buttons for each.
2. **Finding programs on PATH is slow.** The same launch numbers, but most of
   the time spent finding the program. Evidence includes how many folders PATH
   has. Suggests removing folders that no longer exist or are on network
   drives.
3. **Every core is busy with Grove's threads.** A period with the PC's CPU
   averaging 85% or more and threads waiting for a CPU at or above the number
   of cores, with 5 or more threads working. Suggests running fewer threads at
   once.
4. **Installs in worktrees are loading the disk.** Disk busy averaging 70% or
   more, or 10 or more event log writes over 1 s in the hour, together with 2
   or more installs run by agents. Evidence: "3 threads ran npm ci this hour.
   Each writes the whole node_modules (about 1 GB, 38,000 files, for this
   project)." Suggests the antivirus exception for the worktree folder. Later:
   sharing `node_modules` across worktrees, if we build that.
5. **New threads are slow to set up.** The worktree step's median over 15 s
   across 3 or more new threads. Suggests the antivirus exception, or a worktree
   folder on a faster drive (button: Settings > Git).
6. **Memory is running low because of idle agents.** Free memory under 10% of
   RAM, or paging in averaging 100 pages/s or more, while threads sit idle with
   their agent still running. Suggests a shorter idle sleep (button: the
   `idleSleepMinutes` setting, showing its current value).
7. **The taskbar badge or notifications froze the window.** Window freezes in
   the hour where `win:setAttentionBadge` or `notify:show` held the main process
   for 3 s or more in total. Suggests turning off the taskbar badge (button:
   `notifyTaskbarBadge`).
8. **You're running the dev build.** Not packaged, and 30 or more slow window
   frames in a period. Says the dev build draws slower than the installed app,
   so window numbers are pessimistic.

With too little data (under 10 minutes of running, or no launches), the
button says so rather than give an all-clear.

## The notice

- Shown in the app (a toast, like `PlanUsageToast.svelte`), never as a desktop
  notification: a slow PC isn't urgent.
- Only for checks 1 to 7, and only once a check has fired for two periods in a
  row (20 minutes), so a single burst doesn't raise it.
- At most once a day per check. **See why** opens Settings > Field notes and
  runs the check. **Don't show this again** mutes that check's notice (saved
  in settings), while the button still reports it.

## Not in v1

- Naming which process under an agent uses the memory. Windows 10 has no
  Process V2 counters, so Grove can only count the agents themselves there.
- Changing anything by itself. Grove suggests and opens settings; you decide.
- An agent reading the log.

## Work

1. `perf-check.ts`: the hour's window, the checks, and tests with numbers from
   the real log.
2. Counters and hooks in the modules above (small, each with a test).
3. IPC: `perf:check` (on demand) and a pushed `perf:finding` for the notice.
4. Field notes: the button and the findings list (UI kit `Notice`, `Button`).
5. The toast, with its once-a-day and mute rules.
6. Help: a paragraph in `docs/help/settings.md` under Field notes.
