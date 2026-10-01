# Landing page

The Grove Bench site, published to GitHub Pages by `deploy-landing.yml` on
pushes to main. A light, product-style page in Grove Bench's world: it turns
from morning to night as you scroll, and a path runs down its left edge. One
agent walks down it, trees sprout as it nears them, and at each section it
sits on a bench in that section's pose.

```bash
cd landing
npm run dev       # dev server
npm run build     # builds into landing/dist
```

## How the page is put together

- `index.html`: meta tags, structured data and the `<noscript>` fallback for
  crawlers. Keep the fallback's copy in step with `src/sections/content.js`.
- `src/App.svelte`: the page plus the analytics consent banner
  (`ConsentBanner.svelte`, `lib/analytics.js`; nothing is sent before
  consent).
- `src/trail/`: the page layout (`Trail.svelte`) and the path (`Rail.svelte`).
- `src/sections/`: the sections and their copy (`content.js`), the
  day-to-night palette and type (`day.css`, with the same colours in
  `sky.js`), and scroll tracking with the "arrive" reveal
  (`scroll.svelte.js`).
- `src/shared/app/`: a copy of the app window's look, checked against the
  app in its demo mode (`demo.html`). The hero uses it with sample
  conversations; visitors can click conversations, tabs and the permission
  prompt. On phones the hero shows the sidebar and the open prompt instead,
  at full size.
- `src/shared/app-art.js`: the app's own sprite code from `src/renderer/lib`,
  so every pose, colour, look and scene is what the app draws. The deploy
  workflow also runs when those files change.

## Analytics events

Only after consent: `download_click`, `github_click` and `docs_click` (with a
`location` such as `trail-hero`), `footer_click` (with the link), and
`trail_conversation_open` when a visitor opens a sample conversation in the
hero.

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
signed Parsons Projects.

The app window is dark because the app is dark-only; it sits on the light
page as a product shot.

## Checked

- Chromium at 15 sizes, from 320x568 to 2560x1440, including the common
  Windows laptop sizes (1366x768, 1536x864) and the widths where the layout
  switches (760, 860, 900, 960). An audit script checked each one for
  sideways scrolling, clipped text, words past the edge, trail art over
  words and small tap targets on phones.
- With reduced motion, everything is visible and scenes rest on their last
  frame.
- Not yet: other browsers, real phones, screen readers.
