# Landing page prototypes

Two takes on a lighter, product-style landing page, in the spirit of a clean
SaaS page (big two-tone headline, the real app as the hero, a founder note,
feature cards, an FAQ and a bold closing banner) but in Grove Bench's own
world. Both turn from morning to night as you scroll, and the grove and its
agents grow down the page. Canopy (`landing/src/canopy`) stays the live page.

```bash
cd landing
npm run dev:prototypes     # serves prototypes/, open the chooser at /
npm run build:prototypes   # builds into landing/dist-prototypes/ (git-ignored)
```

`npm run build` and the Pages deploy don't include them.

## The two variants

Both use the same sections, from `day/`: nav (its clock runs from 08:00 to
22:00 as you scroll), hero with the app window and numbered notes, founder
note, six feature cards, three steps, "free", FAQ and a night closing banner.
Only the grove differs.

### Meadow (`meadow.html`)

A strip of grove sits between each pair of sections, and each one is fuller
than the last: one tree on main in the morning, then three conversations with
their own trees and branch tags, then one that needs you, then ones that have
finished, then dusk, when idle agents nap and the lamps come on. New trees
grow and new agents walk in to their benches as each strip arrives. The
undergrowth along each strip is the app's context grove code, filling a bit
more each time.

- Strength: the grove reads as "more conversations through the day", and
  each strip says what's happening in one line.
- Trade-off: the strips add height; five may be one or two too many.

### Trail (`trail.html`)

A path runs down the left edge. One agent walks down it as you scroll (it only
steps while the page moves), trees sprout as it nears them, and at each
section it sits on a bench in that section's pose: ready, working, waiting
for you, finished, asking, asleep. Lamps along the last stretch light up at
night.

- Strength: one character, one day: the page itself becomes the story.
- Trade-off: on phones the path takes 56 px of width, and the content gets
  narrower.

## Shared parts

- `day/`: copy (`content.js`), the day-to-night palette and type
  (`day.css`), scroll tracking and the "arrive" reveal (`scroll.svelte.js`),
  and the sections.
- `shared/app/`: a copy of the app window's look, checked against the app in
  its demo mode (`demo.html`). The hero uses it with sample conversations;
  you can click conversations, tabs and the permission prompt.
- `shared/app-art.js`: the app's own sprite code from `src/renderer/lib`, so
  every pose, colour, look and scene is what the app draws. Plain relative
  imports: the app's dev server scans every HTML file in the repo and reports
  an unknown alias as missing packages. If any of this moves into the live
  page, `deploy-landing.yml` would need to rebuild on changes to those app
  files too.

## Copy

Facts follow `README.md`, `docs/help` and the source (for example the FAQ's
SmartScreen answer, requirements, privacy and modes). The founder note is a
draft in Alan's voice and is marked as one on the page; it needs rewriting.

The app window is dark because the app is dark-only; it sits on the light page
as a product shot.

## Not checked yet

- Real devices and browsers beyond Chromium. Screens checked at 1440 and 390
  px wide.
- Screen readers. Decorative scenes are hidden from them; the FAQ uses native
  `<details>`.
- Copy accuracy was checked against `docs/help` and the source on 2026-10-01.
