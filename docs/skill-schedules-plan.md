# Scheduled skills: Plan

> **Status: proof of concept.** Any agent's skill can be run once in a new thread, or put on a schedule, and schedules can be edited, paused and run now. Not yet tried in the packaged Windows app. What's left is at the end.

## What it is

A skill tells the agent **how** to do a job. Its schedule says **when** to start a thread that does it, and how: the agent, an optional note sent with the skill, the mode, whether the thread gets a new branch or runs in the project folder, and a cap on open threads. The agent never sees the schedule, only the first message: "Use the `<skill>` skill for this task", then the note.

This started as "recipes", a separate saved thread start with an optional skill. In practice a recipe was a skill on a schedule, so the separate idea was dropped: a schedule now always runs a skill, and a job without one gets a skill first.

The aim is a small, supervised "software factory": for example, every 2 hours run a `work-linear-issue` skill with the note "take the top issue labelled `agent-ready`", with PR auto mode handling CI and reviews, and a person watching the threads it starts.

## Where you see it

A **Skills drawer** slides out on the right (`SkillsPanel.svelte`), in place of the Skills popover and the Scheduled skills dialog, which ran out of room. It has two tabs:

- **This thread:** the open thread's skills, each with **Run** (a new thread now, on this thread's agent and model) and **Schedule** (the Scheduled tab, on a new schedule for the skill), plus Add skill, and Share and Link when there is something to share or link (below). For Claude Code, also Disable and Enable, and suggestions.
- **Scheduled:** every project's schedules, grouped by project, with Run now, Pause, Edit and Delete, and Schedule a skill per project. The form opens in the tab. A removed project's schedules stay listed (skipped and noted when due, without a toast) so they can be deleted, and run again if the project comes back.

**Skills** in the status bar opens This thread; the **clock on a project's header** in the sidebar opens Scheduled with that project first. Escape closes the form, then the drawer. MCP stays a popover: its job is a glance and a reconnect, and its setup lives in Settings.

## Skills across agents

All five agents Grove knows read the same Agent Skills format (a folder with a `SKILL.md` that has `name` and `description`), but each looks in its own folders, and no one folder is read by all five:

| Agent | Project folders | User folders |
|---|---|---|
| Claude Code | `.claude/skills` | `~/.claude/skills` |
| Gemini CLI | `.agents/skills`, `.gemini/skills` | `~/.agents/skills`, `~/.gemini/skills` |
| Copilot CLI | `.github/skills`, `.claude/skills`, `.agents/skills` | `~/.copilot/skills`, `~/.agents/skills` |
| OpenCode | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` |
| Custom agents (Codex through codex-acp, say) | `.agents/skills` | `~/.agents/skills` |

Sources: [Claude Code](https://code.claude.com/docs/en/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), [Copilot](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), [OpenCode](https://opencode.ai/docs/skills/), [Codex](https://developers.openai.com/codex/skills).

Each ACP agent definition names its folders (`skillDirs` in `adapters/acp/presets.ts`), and `AcpAdapter.listSkills` reads them. `capabilities.skills` stays off for ACP agents: it means Grove manages the skills (turns them off, suggests new ones), which only works through Claude Code. So for other agents the drawer shows Run, Schedule and Add skill but not Disable or Suggest.

## Skills every agent can use

Claude Code is the only agent here that doesn't read `.agents/skills`: its docs list only `.claude/skills` folders (personal, project, nested, `--add-dir`, plugins, managed). So Grove makes `.agents/skills` the home for skills, in the project and in the home folder, and bridges Claude Code with **links**:

- A link is `.claude/skills/<name>/SKILL.md` with the shared skill's own frontmatter (so Claude Code lists it by the same name and description, with the same settings, such as `disable-model-invocation`) and a body that says to read and follow `.agents/skills/<name>/SKILL.md`. A comment line marks it as Grove's. Project links point from the project root, so they work in a teammate's copy without Grove; user links use the full path.
- Plain files, not symlinks: Git for Windows turns symlink support off unless it detects Developer Mode or it was turned on at install ([Git for Windows](https://gitforwindows.org/symbolic-links)), and with `core.symlinks` off a symlink is checked out as a small plain file holding the link text ([git config](https://github.com/git/git/blob/master/Documentation/config/core.adoc)). Not an SDK plugin either: plugin skills are renamed `plugin:skill`, and only Grove's threads would see them, not Claude Code run by hand.
- **Add skill** writes to `.agents/skills` for every agent, plus a link when the thread's agent is Claude Code (`writeSkill`). Ask Agent to Write It tells the agent to use `.agents/skills` too; in a Claude Code thread, Link then adds its link.
- **Share** (any thread) moves skills that are only in Claude Code's folders to `.agents/skills`, each leaving a link. **Link** (Claude Code threads) adds missing links, rewrites ones whose frontmatter no longer matches, and removes ones whose skill was deleted. A skill in both folders under one name is left alone. Grove never does either by itself: both change files in the project.
- Mid-chat, every agent finds the skills itself, as it would without Grove: Gemini CLI, Copilot CLI, OpenCode and Codex in `.agents/skills`, Claude Code through its links.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where schedules live | `app-state.json`, on this machine (`skillSchedules`) | A schedule kept in the repository would fire on every teammate's copy of Grove |
| Who starts the thread | The renderer, through `draftStore.startThreadFor` | Every thread starts there, so a scheduled thread shows and behaves like one started by hand |
| Who keeps time | Main (`src/main/skill-schedules.ts`), checking once a minute | Running state stays in one place and is saved with the schedule |
| Missed times | Only the latest time since the last check counts: it runs if it is at most 15 minutes late, and is skipped and noted otherwise. Earlier missed times are dropped, not caught up | Supervised: nothing should start a burst of threads when the laptop wakes, but a time just gone should still run |
| When Grove is closed | Nothing runs (no tray mode). The scheduler starts once the window has restored its threads (60 seconds at most) and stops for good when shutdown starts, Restart to update included. A run due before the window has its threads back is skipped and noted | Fine for supervised use; no thread starts while the others are closing, or before the cap can count the threads a schedule already has |
| A run nobody answered | Main waits up to 5 minutes for the window to say what a due run did, then notes it as not started | A window reloading at the wrong moment doesn't leave the schedule showing its previous run |
| Focus | A scheduled run starts without taking the screen; Run and Run now open the thread | Not interrupting what you're reading |
| Cap | A scheduled run is skipped while `maxOpen` of its threads are still open (`isOpenTab`: not closed or deleted, threads waiting to reconnect after a restart or wake included). Run now ignores it | Stops a schedule piling up threads you haven't looked at |
| Agent | Required, and never swapped: a turned-off or removed agent means the run doesn't start (`startThreadFor`'s `strictAgent`, which loads the agents first) | A skill lives in its agent's folders, and the tools it needs (an issue tracker's MCP server) may only be set up for that agent |
| Note | Optional text sent after the skill's name | One skill can serve several schedules ("the top `agent-ready` issue", "the oldest bug") |
| Where skills live | `.agents/skills` (project and home), with links in `.claude/skills` for Claude Code | The one folder five agents share; links keep Claude Code's names and work in git on Windows |
| Moving existing skills | Only when the person clicks Share or Link | Both change files in the repository, which a teammate reviews |
| Issue tracker | Grove never talks to it. The skill or the note tells the agent to fetch work with its own MCP tools; moving the issue to In Progress is the lock that stops the next run taking it | Works with Linear, GitHub Issues, Jira or anything else with an MCP server |

## Where the code is

- `src/shared/skill-schedules.ts`: types, `nextRunAt` and `scheduleDueAt` (timing maths, local time), `skillRunPrompt`
- `src/main/skill-schedule-schema.ts`: Zod checks for saved schedules and for what the form sends
- `src/main/skill-schedules.ts`: save, delete, note a run, `takeDue` and the scheduler (`SKILL_SCHEDULES_CHANGED`, then `SKILL_SCHEDULE_DUE` to the window). A run's record goes through `updateSkillSchedules`, so a passing lock on app-state.json doesn't lose it
- `src/main/skills.ts`: `SkillDirs` lists several folders per level; `writeSkill` writes to `.agents/skills`, plus a link (`skillLinkContent`) for an agent whose folders don't include it
- `src/main/skill-sharing.ts`: `skillSharing` (what Share and Link would do), `shareSkills`, `linkSkills`; `skills:sharing`, `skills:share` and `skills:link` in `ipc.ts` pick Claude Code's folders (the thread's own Claude account's, or the default's)
- `src/main/adapters/acp/`: `skillDirs` per agent, `AcpAdapter.listSkills` and `addSkill`
- `skills:listForAgent` IPC: an agent's skills in a project, without a thread (the schedule form's picker)
- `src/renderer/stores/schedules.svelte.ts`: the list, `runSkill` (once, by hand) and `run` (a schedule, with the cap)
- `src/renderer/stores/skillsPanel.svelte.ts`: the drawer's state (open, tab, the project listed first, the form)
- `src/renderer/components/SkillsPanel.svelte`: the drawer, mounted in `App.svelte`; `ThreadSkills.svelte` and `ScheduledSkills.svelte` are its tabs, `ScheduleForm.svelte` the form (the agent's own modes only, no turned-off Claude Code skills)
- `src/renderer/components/StatusBarSkills.svelte`: the status bar's Skills count, which opens the drawer
- `src/renderer/stores/draft.svelte.ts`: `startThreadFor` returns the new thread's id or why it didn't start, and takes `controls`, `focus`, `strictAgent` and `quiet`

## Limits of the POC

- If the agent dies partway, an issue it took stays In Progress in the tracker. Grove can't see the tracker, so it can't undo that.
- Grove shows no queue of waiting issues; only the tracker knows what is next.
- Each agent needs the tracker's MCP server set up in its own config. ACP agents only get Grove's own MCP servers from Grove (`acp-adapter.ts`).
- The folder lists come from each agent's docs as of October 2026 and aren't checked against the agents themselves. Earlier folders win on a name clash: for OpenCode that follows its docs; for Gemini CLI, Google's docs don't say, and the order (`.agents/skills` first) follows third-party guides. OpenCode's user folders on Windows are assumed to be under the home folder like elsewhere.
- Skills are listed from the project folder, on whatever branch it has checked out, but a "New branch" run's worktree starts from the base branch. A skill that exists only on a feature branch is listed, but the run's worktree doesn't have it, so the agent is told to use a skill it can't find. Checking each skill on the base branch would need git calls per listing; not worth it for this case.
- If noting a run fails after its thread started (the IPC call itself failing, as main's handler doesn't throw), the thread isn't counted for the cap and main later notes the run as not started.
- Loading the schedules while app-state.json is locked retries as the To do and group stores do; the three copies of that loop could become one helper.
- Schedules for a removed project stay saved, skipped each time they're due, until deleted in the Scheduled tab.
- Copilot CLI and OpenCode read both `.claude/skills` and `.agents/skills`, so they see a link and its skill under one name. Which they use, and whether they complain, isn't checked; either way the link sends them to the same file.
- A shared skill that uses Claude Code's `${CLAUDE_SKILL_DIR}` gets the link's folder, not its own, and other agents don't fill it in at all. Shared skills should give paths relative to their folder, as the link's body says.
- Claude Code's docs say a personal skill wins over a project skill of the same name; Grove's list (`listSkills`) shows the project one. Not changed here.
- Skills in other agents' own folders (`.gemini/skills`, `.github/skills`, `.opencode/skills`) aren't offered for Share.
- A user-level link in a Claude account's folder is only made from a thread on that account.
- Whether this raises throughput is unproven. Worth counting, per schedule, how many of its threads end in a merged PR against how many were closed.

## What's left

1. Try it in the packaged app on Windows, with a real Linear MCP server and a non-Claude agent, for a day of runs.
2. A help page (`docs/help/`), and a label on the threads a schedule started.
3. Show "merged of started" per schedule, so it proves its worth or gets dropped.
4. Remove a project's schedules with the project.
5. Decide whether runs with nobody watching are wanted. That points to a headless runner, not this desktop app.
