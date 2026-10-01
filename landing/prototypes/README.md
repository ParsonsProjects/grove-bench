# Landing page prototypes

Four interactive ideas for showing how Grove Bench works, built around the
grove characters. Canopy (`landing/src/canopy`) stays the live page; these
are for trying out, and for borrowing pieces from.

```bash
cd landing
npm run dev:prototypes     # serves prototypes/, open the chooser at /
npm run build:prototypes   # builds into landing/dist-prototypes/ (git-ignored)
```

`npm run build` and the Pages deploy don't include them.

## The characters are the app's own

`shared/app-art.js` imports the sprite code from `src/renderer/lib`
(`agent-sprite.ts`, `pixel-tree.ts`, `grove-walk.ts`, `context-grove.ts`)
through the `@app-art` alias in `vite.prototypes.config.js`. So every pose,
colour, look, scene and timing here is what the app draws, and they stay in
step when the app changes. Canopy copies its art instead. If one of these
moves into the live page, the deploy workflow (`deploy-landing.yml`) would
need to rebuild on changes to those files too, since it only watches
`landing/**`.

Shared pieces:

| File | What it is |
| --- | --- |
| `Sprite.svelte` | One character in any state, with the app's look-from-id |
| `BenchSeat.svelte` | A character on its bench, placed as in the app's empty state |
| `GroveScene.svelte` | The app's empty-state scene: tree, bench, lamp or tab prop |
| `GroveWalk.svelte` | The grove walk: arrival and wake-up scenes |
| `ContextStrip.svelte` | The context grove that fills as context is used |
| `Walker.svelte`, `Tree.svelte`, `Pixels.svelte`, `Bubble.svelte` | Smaller parts |
| `Shell.svelte`, `proto.css` | Page frame and the Canopy palette |

## The four directions

### Grovekeeper (`grovekeeper.html`)

A small game. You run one project for a working day (four minutes): start
tickets, and each gets a tree (worktree), a branch and an agent who walks up
to the bench. Agents raise an amber hand for permission, wave when done, and
fall asleep if left. You review, send a follow-up, Rewind all, or Create PR
and the agent walks to the main gate.

- Shows: the whole loop, modes (Ask, Edit, Auto), the permission buttons as
  labelled in the app (Allow, Deny, Allow all commands, Allow all edits (Edit
  mode)), the `grove/<id>` branch being renamed after the first reply, Auto
  blocking a `curl | sh`, checkpoints, sleep and wake.
- A log under the task board says what the app did at each step.
- Trade-off: the most to take in. Best as its own page ("Try it") linked from
  the hero rather than the hero itself.

### Meet the crew (`crew.html`)

A character select screen. Twelve poses, one per state, each with what it
means and what to do (from `docs/help/session-states.md`). Then a builder:
look from a conversation id (the app's `agentLook`), laptop logo colour,
model (with real facts: context window, default effort, Fast, Auto),
mode, and the caveman response styles. Then "a day in the grove", a timeline
you scrub through, with the sidebar row, filter counts, prompt characters and
context grove for each moment. Last, where the characters turn up.

- Trade-off: long. The select screen alone would make a good Canopy section.

### Pocket grove (`pocket.html`)

A handheld you play with the buttons or keys. Three conversations to start;
one asks for permission, one has finished, one is asleep. The top row is the
sidebar's filter chips, the lights and buzz stand in for notifications, the
dots for the rail, and the grass strip is the context grove (SELECT runs
`/compact`). START adds a conversation.

- Trade-off: the most fun, and teaches status at a glance, but less about
  worktrees.

### Parallel race (`race.html`)

The same 2 to 4 tasks run three ways: one agent at a time, several agents in
one folder, and a worktree each. Two real failure modes show up in the shared
folder: an edit fails because another agent changed the file after it was
read, and a test run fails on someone else's half-finished change. The
Grove Bench lane ends with one branch per task, and says plainly that
branches touching the same file still merge like any branches.

- Trade-off: the clearest "why", the least about the characters. Timings are
  made up and say so.

## Not checked yet

- Real devices and browsers beyond Chromium. Screens checked at 1440 and 390
  px wide.
- Screen readers. Controls are buttons and radios with labels, and the game
  thread is a live region, but nobody has used them with one.
- Reduced motion: loops stop and scenes jump to their end, but the games still
  run on a clock.
- Copy accuracy was checked against `docs/help` and the source on 2026-10-01.
