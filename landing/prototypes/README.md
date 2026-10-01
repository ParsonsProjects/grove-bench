# Landing page prototypes

Three ideas for showing how Grove Bench works, with the grove characters in
the places they actually appear in the app. Canopy (`landing/src/canopy`)
stays the live page; these are for trying out, and for borrowing pieces
from. None of them is a game: visitors watch, scroll, pause and click around.

```bash
cd landing
npm run dev:prototypes     # serves prototypes/, open the chooser at /
npm run build:prototypes   # builds into landing/dist-prototypes/ (git-ignored)
```

`npm run build` and the Pages deploy don't include them.

## The art and the layout are the app's own

- `shared/app-art.js` imports the sprite code from `src/renderer/lib`
  (`agent-sprite.ts`, `pixel-tree.ts`, `grove-walk.ts`, `context-grove.ts`),
  so every pose, colour, look, scene and timing is what the app draws. The
  imports are plain relative paths: the app's own dev server scans every HTML
  file in the repo, and an alias it doesn't know would read as a missing
  package there.
- `shared/app/` is a copy of the app window's look (colours from
  `src/renderer/styles/globals.css`), checked against the app running in its
  demo mode (`demo.html`): sidebar rows, filter chips, thread blocks,
  permission prompts, the Changes and Checkpoints tabs, the status bar with
  its context grove, and the draft pane. Labels and wording come from the
  source (for example `session-subtitle.ts`, `always-allow.ts`,
  `DraftPane.svelte`, `PermissionBlock.svelte`) and `docs/help`.

If any of this moves into the live page, the deploy workflow
(`deploy-landing.yml`) would need to rebuild on changes to those app files
too, since it only watches `landing/**`.

## The three directions

### Live app (`live.html`)

The Grove Bench window, playing a 50-second session on one project: a
conversation finishing in Auto mode, one waiting for permission in Ask mode,
one asleep, and a new one started from a draft (its agent walks in, and the
`grove/<id>` branch is renamed after the first reply). A pointer does the
clicking; captions say what's happening; chapter buttons jump to a moment.
Clicking anything in the window pauses the tour and does what the app would,
and Resume tour picks it up again.

- Strength: the most honest picture of the product, and the characters are
  shown exactly where they live.
- Trade-off: a desktop window shrunk onto a phone is hard to read. A phone
  version would need its own layout (for example one pane at a time).

### One conversation (`story.html`)

An editorial page that follows one conversation through a day, from the
first message to a pull request, as you scroll: the draft, the worktree, the
walk-in, the thread, the rename, permissions, the wave and notification, the
diff, checkpoints, the others in the sidebar, sleep and wake, the context
grove, and the PR. A sticky stage shows the matching piece of the app.
Two chapters have toggles: pick a mode to see what happens to `npm test`, and
pick Rewind all or Conv. only to see what comes back.

- Strength: explains the most, in order, at the reader's pace.
- Trade-off: long. A shorter cut (5 or 6 chapters) might suit the live page.

### Short loops (`loops.html`)

Nine features, each a short paragraph next to a looping scene: worktrees,
status at a glance, permissions, checkpoints, terminals, sleep and wake, the
context grove, project memory, and review and ship. Hover to pause; the
buttons pause and step through, with a caption per step. Loops only run
while on screen.

- Strength: quick to scan, and each card works on its own, so any of them
  could drop into Canopy.
- Trade-off: the least sense of the whole workflow.

## Not checked yet

- Real devices and browsers beyond Chromium. Screens checked at 1440 and 390
  px wide.
- Screen readers. Controls are buttons with labels and captions are live
  regions, but nobody has used them with one.
- Copy accuracy was checked against `docs/help` and the source on 2026-10-01.
