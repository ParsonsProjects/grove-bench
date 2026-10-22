# Recipes: Plan

> **Status: proof of concept.** Recipes can be added, edited, paused, run by hand and run on a schedule. Not yet tried in the packaged Windows app. What's left is at the end.

## What a recipe is

A skill tells the agent **how** to do a job. A recipe tells Grove **when and where** to start a thread that does it: the project, the agent, whether it gets a new branch or runs in the project folder, the mode, an optional skill, the first message and a schedule. The agent never sees the recipe, only the first message it sends.

The aim is a small, supervised "software factory": a recipe such as "every 2 hours, take the top Linear issue labelled `agent-ready`, move it to In Progress, fix it and open a PR", with the PR auto mode handling CI and reviews, and a person watching the threads it starts.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Where recipes live | `app-state.json`, on this machine (`recipes` field) | A schedule kept in the repository would fire on every teammate's copy of Grove |
| Who starts the thread | The renderer, through `draftStore.startThreadFor` | Every thread starts there, so a recipe's thread shows and behaves like one started by hand |
| Who keeps time | Main (`src/main/recipes.ts`), checking once a minute | It keeps running state in one place and saves it with the recipe |
| Missed times | Only the latest time since the last check counts: it runs if it is at most 15 minutes late, and is skipped and noted otherwise. Earlier missed times are dropped, not caught up | Supervised: nothing should start a burst of threads when the laptop wakes, but a time just gone should still run |
| When Grove is closed | Nothing runs (no tray mode). The scheduler starts once the window has restored its threads (60 seconds at most) and stops for good when shutdown starts, Restart to update included | Fine for supervised use, and no thread starts while the others are closing |
| A run nobody answered | Main waits up to 5 minutes for the window to say what a due run did, then notes it as not started | A window reloading at the wrong moment doesn't leave the recipe showing its previous run |
| Focus | A scheduled run starts without taking the screen; Run opens the thread | Not interrupting what you're reading |
| Cap | A scheduled run is skipped while `maxOpen` of the recipe's threads are still open (`isOpenTab`: not closed or deleted, threads waiting to reconnect after a restart or wake included). Run by hand ignores the cap | Stops a recipe piling up threads you haven't looked at |
| Agent | A recipe whose agent is turned off or removed doesn't run, rather than falling back to the default agent (`startThreadFor`'s `strictAgent`, which loads the agents first) | The recipe's tools (an issue tracker's MCP server) may only be set up in that agent |
| Issue tracker | Grove never talks to Linear. The first message tells the agent to fetch work with its own MCP tools; moving the issue to In Progress is the lock that stops the next run taking it | Works with GitHub Issues, Jira or anything else with an MCP server, by changing the message |
| Name | "Recipe", as in TODO.md | Easy to rename while it is a POC; "Job" or "Schedule" may be clearer next to "skill" |

## Where the code is

- `src/shared/recipes.ts`: types, `nextRunAt` (schedule maths, local time), `recipePrompt` (names the skill in plain words, so it works for any agent)
- `src/main/recipe-schema.ts`: Zod checks for saved recipes and for what the renderer sends
- `src/main/recipes.ts`: save, delete, note a run, `takeDue` and the scheduler (`RECIPES_CHANGED`, then `RECIPE_DUE` to the window). A run's record goes through `updateRecipes`, so a passing lock on app-state.json doesn't lose it
- `src/main/app-state.ts`: `loadRecipes`, `saveRecipes`
- `src/renderer/stores/recipes.svelte.ts`: the list, and `run()` with the cap and agent checks
- `src/renderer/components/RecipesDialog.svelte`: opened from the clock button on a project's header in the sidebar (always shown once the project has a recipe, else on hover)
- `src/renderer/stores/draft.svelte.ts`: `startThreadFor` returns the new thread's id or why it didn't start, and takes `controls`, `focus`, `strictAgent` and `quiet`

## Limits of the POC

- If the agent dies partway, the issue it took stays In Progress in the tracker. Grove can't see the tracker, so it can't undo that.
- Grove shows no queue of waiting issues; only the tracker knows what is next.
- Each agent needs the tracker's MCP server set up in its own config. ACP agents only get Grove's own MCP servers from Grove (`acp-adapter.ts`).
- Recipes for a removed project stay saved and fail with "its project was removed" until deleted.
- Number fields left empty fail to save with Zod's own message rather than a friendly one.

## What's left

1. Try it in the packaged app on Windows, with a real Linear MCP server, for a day of runs.
2. A help page (`docs/help/`), and a "Recipe" label on the threads a recipe started.
3. Pick a skill from a list instead of typing its name (needs a skills list per agent and project, not per thread as `SKILLS_LIST` is today).
4. Remove a project's recipes with the project.
5. Decide whether runs with nobody watching are wanted. That points to a headless runner, not this desktop app.
