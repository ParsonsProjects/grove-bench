# Landing page prototype: Trail

A lighter, product-style landing page in Grove Bench's world. The page turns
from morning to night as you scroll, and a path runs down its left edge: one
agent walks down it, trees sprout as it nears them, and at each section it
sits on a bench in that section's pose. Canopy (`landing/src/canopy`) stays
the live page until this replaces it.

```bash
cd landing
npm run dev:prototypes     # serves prototypes/ at /
npm run build:prototypes   # builds into landing/dist-prototypes/ (git-ignored)
```

`npm run build` and the Pages deploy don't include it.

## How the page is put together

- `index.html` and `trail/`: the page, and the path (`Rail.svelte`).
- `day/`: the sections and their copy (`content.js`), the day-to-night
  palette and type (`day.css`, with the same colours in `sky.js`), and scroll
  tracking with the "arrive" reveal (`scroll.svelte.js`).
- `shared/app/`: a copy of the app window's look, checked against the app in
  its demo mode (`demo.html`). The hero uses it with sample conversations;
  visitors can click conversations, tabs and the permission prompt. On phones
  the hero shows the sidebar and the open prompt instead, at full size.
- `shared/app-art.js`: the app's own sprite code from `src/renderer/lib`, so
  every pose, colour, look and scene is what the app draws. Plain relative
  imports: the app's dev server scans every HTML file in the repo and reports
  an unknown alias as missing packages.

### The look

Type, buttons and labels come from the app, not from a generic product page:

- Headings are plain sentence case in JetBrains Mono. The opening and
  closing lines are messages you send, with the Thread tab's prompt mark,
  blue bar and a blinking caret.
- Each section is labelled with a branch name (`Branch.svelte`): the trail is
  main and the sections branch off it.
- Buttons are the app's: square, flat, 1px edge.
- The founder note is a commit in the Terminal tab (`git log -1`, signed off
  by Parsons Projects; cmd.exe prompt, as the app's terminal uses).
- What you get is a file added in the Changes tab, one green line each.
- The FAQ is a Thread: each question is your message, opening it shows the
  reply.
- Under the hero window, a line says what the conversation you point at is
  doing, in the help pages' words. Opening the sleeping one wakes it.

### The path

- The agent starts on the first bench, half way down the window, and stands
  up when you scroll. It only steps while the page moves.
- At each section it sits down (the plain seated pose first, then the
  section's pose): ready, working, working, waiting for you, finished,
  asking, asleep.
- It never walks off either end: the last bench is at the end of the path,
  as far down as it can get, so at the bottom of the page it's asleep there.
- Each feature sits on a side path off the trail, pictures alternating
  sides. Side paths grow out as the agent nears them; any element with
  `data-spur` gets one.
- Trees ahead of it sprout as it nears them and stay grown. Lamps along the
  last stretch light up at night.
- The art is 4x on wide screens, 3x on mid-size and 2x on phones.

### Day into night

Each band's colours run into the next. The nav takes the exact colour of
the sky behind it and switches to light text over dark sky; its clock runs
from 08:00 to 22:00 with the page. The sunset band sinks the sun behind a
treeline as it scrolls up.

## Copy

Facts follow `README.md`, `docs/help` and the source (requirements, modes,
the FAQ's SmartScreen and privacy answers). Git is recommended, not
required (`src/main/prerequisites.ts`), and Claude Code is optional with an
API key, so the page never lists either as a must. The founder note is
signed Parsons Projects; its text is still a draft, marked as one on the
page.

The app window is dark because the app is dark-only; it sits on the light
page as a product shot.

## Before it replaces Canopy

- Analytics and the consent banner (`landing/src/lib/analytics.js`,
  `ConsentBanner.svelte`) aren't wired in.
- The `<noscript>` fallback, structured data and social image from
  `landing/index.html` need carrying over.
- If it imports from `src/renderer/lib`, `deploy-landing.yml` should also
  rebuild on changes there (it only watches `landing/**`).

## Checked

- Chromium at 1440, 1280, 1024 and 390 px wide, with and without reduced
  motion (with it, everything is visible and scenes rest on their last frame).
- No horizontal scrolling at any of those widths.
- Not yet: other browsers, real phones, screen readers.
