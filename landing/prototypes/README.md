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

All three keep the brand (pixel tree, JetBrains Mono, square corners, blue primary), load the font properly, keep content visible without waiting for scroll observers, pause animation off screen, and fall back to a still frame under `prefers-reduced-motion`. Visible copy says "AI agents" rather than naming a product (only the requirements line names the Claude Code CLI, because the app needs it), uses "conversation" and "project", and every feature claim comes from `DESIGN.md` or `docs/help/`.

### A. Branches (`src/prototypes/branches/`, about 3,800 lines)

The page reads like `git log --graph`. A graph in the left gutter draws itself as you scroll. Each section is a commit (hash, branch chip, message as heading). Main forks into three agent lanes, the lanes merge back, and main ends in a pixel tree that grows.

- Live conversation cards stream tool calls beside each lane.
- Three agents edit `src/routes/index.ts` at once, with "conflicts: 0".
- A checkpoint scrubber with This turn / Since here and Rewind all.
- Memory notes pulse down every lane.
- A permission prompt you answer. Until you do, the feat/auth lane stops there.

Good: closest to the current page, text stays real HTML (good for search), one clear idea. Watch: the gutter takes width on phones, and the scroll-tied graph needs care when copy changes.

### B. Workbench (`src/prototypes/workbench/`, about 4,700 lines)

The hero is a playable copy of the app. Two conversations run on load and loop by themselves. The first click hands control to the visitor.

- Start tasks (up to four), answer Allow / Always Allow / Deny, rewind with Rewind all or Conv. only, then Open PR.
- A git graph strip tracks every lane, and "conflicts: 0" never moves.
- Six live feature tiles: diff view, worktrees, terminal, permission modes, memory budget, `gh pr create`.

Good: shows the product instead of describing it, which suits a developer audience best. Watch: it is the most code to maintain, and it has to follow the real UI or it misleads. For example, the app has no one-click merge (only Rebase, Squash, Cherry-pick and Create PR in `GitOpsDialog.svelte` / `CreatePrDialog.svelte`), so the demo button says Open PR.

### C. Night Grove (`src/prototypes/grove/`, about 4,700 lines)

The name made literal: a pixel-art grove where each agent works at its own bench under its own tree. It's drawn on a small canvas scaled up by whole pixels.

- Fireflies follow the pointer. Click an agent for an RPG-style dialogue; one asks for permission.
- Plant a tree starts a new conversation: the tree grows, and an agent walks in and sits down.
- Scrolling moves night to day through five chapters: worktrees, terminals, memory, a sundial for checkpoints, and branches heading home to main.

Good: the most memorable and shareable, with a strong personality. Watch: it may undersell a serious developer tool, it holds less information, and the scene is canvas (the copy in the dialogue box is still HTML).

## My take

Branches is the safest base. Workbench makes the strongest case for the product. A mix could work: the Branches page structure with the Workbench simulator as its hero. Night Grove would suit a launch post or release page better than the main page. That is a judgement call, so push back if you see it differently.

## Not checked yet

- Google Fonts was blocked in the build sandbox, so the screenshots used a fallback monospace. Check once with JetBrains Mono and Pixelify Sans loaded.
- Only tested in headless Chromium at 1440, 1024/820 and 390 wide. Not tested in Safari, Firefox or on a real phone, and not profiled on low-end hardware.
- The prototypes load fonts from Google Fonts, which sends each visitor's IP address to Google. A Munich court ordered a site owner to pay damages for this under GDPR (LG München I, 20 Jan 2022, 3 O 17493/20). Self-host the fonts (for example `@fontsource/jetbrains-mono`) before going live.
