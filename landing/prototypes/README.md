# Landing page prototypes

Three alternative directions for the landing page. They reuse the site's tokens (`src/styles.css`), the pixel tree and the Svelte 5 + Tailwind setup, and they are kept out of the production build, so nothing here reaches GitHub Pages until one is picked.

## Run them

```bash
cd landing
npm run dev
# http://localhost:5173/grove-bench/prototypes/            chooser
# http://localhost:5173/grove-bench/prototypes/branches.html
# http://localhost:5173/grove-bench/prototypes/workbench.html
# http://localhost:5173/grove-bench/prototypes/grove.html

npm run build:prototypes   # static build in landing/dist-prototypes (git-ignored)
```

## What the current page gets right

- A clear identity: pixel tree, monospace type, square corners, dark palette, one blue accent.
- A short, strong headline ("Parallel AI agents. Zero conflicts.") and the download button above the fold.
- An app mockup in the hero with clickable tabs.

## What holds it back

| Issue | Where |
| --- | --- |
| Six feature blocks with the same layout (label, heading, paragraph, three bullets, static mockup), alternating sides. It reads as a wall of similar text. | `src/App.svelte` lines 547 to 1013 |
| Mockup text is 8 to 10px (`text-[8px]`, `text-[9px]`, `text-[10px]`), unreadable on a phone and hard on a laptop. | hero and feature mockups |
| The hero mockup tabs are clickable but nothing says so. | `src/App.svelte` lines 389 to 419 |
| Motion is limited to fade-in-up and background pixels that peak at 8% opacity, so they are barely visible. Nothing shows the core idea (agents working side by side, then merging) in motion. | `src/styles.css` lines 139 to 148 |
| Sections start at `opacity-0` until an IntersectionObserver fires, so link previews, crawlers and slow devices can see blank blocks. | `src/App.svelte`, every `visible[...] ? ... : 'opacity-0'` |
| No `prefers-reduced-motion` handling anywhere. | `src/styles.css` |
| JetBrains Mono is first in the font stack but never loaded, so most visitors get Consolas or another fallback. | `index.html`, `src/styles.css` |
| The "How it works" steps only exist inside `<noscript>`. | `index.html` |
| The same token meter reads `12.4k / 1M` in the hero and `12.4k / 200k` in feature 01. | `src/App.svelte` lines 129 and 596 |
| The mockups say "Repositories", "Add Repo" and "session", while the app now says "project" and "conversation". | `src/App.svelte` lines 320 and 356, `CLAUDE.md` terminology |
| `featureSections` holds titles and descriptions that are never rendered (the markup repeats them by hand), so the two copies can drift apart. | `src/App.svelte` lines 62 to 105 |
| "Spawn unlimited Claude Code agents" is a claim the app does not make anywhere else. | `src/App.svelte` line 554 |

## The three directions

_Filled in below once each prototype is built._
