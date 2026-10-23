# Scheduled skills: Plan

> **Status: proof of concept.** Any agent's skill can be run once in a new thread, or put on a schedule, and schedules can be edited, paused and run now. Not yet tried in the packaged Windows app. What's left is at the end.

## What it is

A skill tells the agent **how** to do a job. Its schedule says **when** to start a thread that does it, and how: the agent, an optional note sent with the skill, the mode, whether the thread gets a new branch or runs in the project folder, and a cap on open threads. The agent never sees the schedule, only the first message: "Use the `<skill>` skill for this task", then the note.

This started as "recipes", a separate saved thread start with an optional skill. In practice a recipe was a skill on a schedule, so the separate idea was dropped: a schedule now always runs a skill, and a job without one gets a skill first.

The aim is a small, supervised "software factory": for example, every 2 hours run a `work-linear-issue` skill with the note "take the top issue labelled `agent-ready`", with PR auto mode handling CI and reviews, and a person watching the threads it starts.

## Where you see it

- **Skills popover** (status bar): each skill has **Run** (a new thread now, on this thread's agent and model) and **Schedule** (the project's scheduled skills, open on a new schedule for this skill).
- **Clock on a project's header** (sidebar): the project's schedules, with Run now, Pause, Edit and Delete, and Schedule a skill. Always shown once the project has one, on hover before that.

## Skills across agents

All five agents Grove knows read the same Agent Skills format (a folder with a `SKILL.md` that has `name` and `description`), but each looks in its own folders, and no one folder is read by all five:

| Agent | Project folders | User folders |
|---|---|---|
| Claude Code | `.claude/skills` | `~/.claude/skills` |
| Gemini CLI | `.gemini/skills`, `.agents/skills` | `~/.gemini/skills`, `~/.agents/skills` |
| Copilot CLI | `.github/skills`, `.claude/skills`, `.agents/skills` | `~/.copilot/skills`, `~/.agents/skills` |
| OpenCode | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `~/.config/opencode/skills` |
| Custom agents (Codex through codex-acp, say) | `.agents/skills` | `~/.agents/skills` |

Sources: [Claude Code](https://code.claude.com/docs/en/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), [Copilot](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), [OpenCode](https://opencode.ai/docs/skills/), [Codex](https://developers.openai.com/codex/skills).

Each ACP agent definition names its folders (`skillDirs` in `adapters/acp/presets.ts`), and `AcpAdapter.listSkills` reads them. `capabilities.skills` stays off for ACP agents: it means Grove manages the skills (turns them off, suggests new ones, writes them), which only works through Claude Code. So for other agents the Skills popover shows Run and Schedule but not Disable, Suggest or Add skill.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where schedules live | `app-state.json`, on this machine (`skillSchedules`) | A schedule kept in the repository would fire on every teammate's copy of Grove |
| Who starts the thread | The renderer, through `draftStore.startThreadFor` | Every thread starts there, so a scheduled thread shows and behaves like one started by hand |
| Who keeps time | Main (`src/main/skill-schedules.ts`), checking once a minute | Running state stays in one place and is saved with the schedule |
| Missed times | Only the latest time since the last check counts: it runs if it is at most 15 minutes late, and is skipped and noted otherwise. Earlier missed times are dropped, not caught up | Supervised: nothing should start a burst of threads when the laptop wakes, but a time just gone should still run |
| When Grove is closed | Nothing runs (no tray mode). The scheduler starts once the window has restored its threads (60 seconds at most) and stops for good when shutdown starts, Restart to update included | Fine for supervised use, and no thread starts while the others are closing |
| A run nobody answered | Main waits up to 5 minutes for the window to say what a due run did, then notes it as not started | A window reloading at the wrong moment doesn't leave the schedule showing its previous run |
| Focus | A scheduled run starts without taking the screen; Run and Run now open the thread | Not interrupting what you're reading |
| Cap | A scheduled run is skipped while `maxOpen` of its threads are still open (`isOpenTab`: not closed or deleted, threads waiting to reconnect after a restart or wake included). Run now ignores it | Stops a schedule piling up threads you haven't looked at |
| Agent | Required, and never swapped: a turned-off or removed agent means the run doesn't start (`startThreadFor`'s `strictAgent`, which loads the agents first) | A skill lives in its agent's folders, and the tools it needs (an issue tracker's MCP server) may only be set up for that agent |
| Note | Optional text sent after the skill's name | One skill can serve several schedules ("the top `agent-ready` issue", "the oldest bug") |
| Issue tracker | Grove never talks to it. The skill or the note tells the agent to fetch work with its own MCP tools; moving the issue to In Progress is the lock that stops the next run taking it | Works with Linear, GitHub Issues, Jira or anything else with an MCP server |

## Where the code is

- `src/shared/skill-schedules.ts`: types, `nextRunAt` and `scheduleDueAt` (timing maths, local time), `skillRunPrompt`
- `src/main/skill-schedule-schema.ts`: Zod checks for saved schedules and for what the form sends
- `src/main/skill-schedules.ts`: save, delete, note a run, `takeDue` and the scheduler (`SKILL_SCHEDULES_CHANGED`, then `SKILL_SCHEDULE_DUE` to the window). A run's record goes through `updateSkillSchedules`, so a passing lock on app-state.json doesn't lose it
- `src/main/skills.ts`: `SkillDirs` lists several folders per level; the first is where a new skill is written
- `src/main/adapters/acp/`: `skillDirs` per agent, `AcpAdapter.listSkills`
- `skills:listForAgent` IPC: an agent's skills in a project, without a thread (the schedule form's picker)
- `src/renderer/stores/schedules.svelte.ts`: the list, `runSkill` (once, by hand) and `run` (a schedule, with the cap), and the dialog's open state
- `src/renderer/components/SchedulesDialog.svelte`: the project's schedules and the form; mounted in `App.svelte`
- `src/renderer/components/StatusBarSkills.svelte`: Run and Schedule per skill
- `src/renderer/stores/draft.svelte.ts`: `startThreadFor` returns the new thread's id or why it didn't start, and takes `controls`, `focus`, `strictAgent` and `quiet`

## Limits of the POC

- If the agent dies partway, an issue it took stays In Progress in the tracker. Grove can't see the tracker, so it can't undo that.
- Grove shows no queue of waiting issues; only the tracker knows what is next.
- Each agent needs the tracker's MCP server set up in its own config. ACP agents only get Grove's own MCP servers from Grove (`acp-adapter.ts`).
- The folder lists come from each agent's docs as of October 2026 and aren't checked against the agents themselves. OpenCode's user folder on Windows is assumed to be under the home folder like elsewhere.
- Schedules for a removed project stay saved and fail with "its project was removed" until deleted.
- Whether this raises throughput is unproven. Worth counting, per schedule, how many of its threads end in a merged PR against how many were closed.

## What's left

1. Try it in the packaged app on Windows, with a real Linear MCP server and a non-Claude agent, for a day of runs.
2. A help page (`docs/help/`), and a label on the threads a schedule started.
3. Show "merged of started" per schedule, so it proves its worth or gets dropped.
4. Remove a project's schedules with the project.
5. Decide whether runs with nobody watching are wanted. That points to a headless runner, not this desktop app.
