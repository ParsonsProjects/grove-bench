# Grove Bench brand

How Grove Bench looks, sounds and draws itself. It covers the app and the landing page, which share one brand system.

Where things live:

| What | Where |
|---|---|
| Brand colours, status colours, fonts (the source of truth) | `src/renderer/lib/brand.ts` |
| Theme tokens built from them | `src/renderer/styles/globals.css` |
| Logo pixel data | `src/renderer/lib/pixel-tree.ts` |
| Logo files | `docs/brand/` |
| Components and how to use them | [`docs/ui-kit.md`](docs/ui-kit.md) |
| Everything above, drawn by the real code | `/ui-kit.html` on the dev server |

`src/renderer/styles/brand.test.ts` fails if `globals.css` drifts from `brand.ts` or a text colour drops below 4.5:1.

## The idea

Each thread is an agent at its own bench in a grove, working under its own tree (a git worktree). The pixel art says that: the tree logo, the agents on benches, the grove that grows along the status bar.

Around the art, the app is a workbench. The chrome stays quiet so the work stands out, and colour is kept for things that mean something: what needs you, what is working, what changed.

## Name

- **Grove Bench**: two words, both capitalised. Not GroveBench, Grove-Bench or grove bench. The one exception is the landing page's nav and footer, which set it in lowercase to match their terminal-style links.
- **Grove** on its own is fine once the full name has been used ("Grove's own mode").
- `grove-bench` in code, package names and URLs.
- Don't use Claude's or Anthropic's names or logos as part of Grove's own name or feature names. The agent is labelled "Claude Agent" in menus (see DESIGN.md, Naming).

## Logo

The logo is the pixel tree: 26 square pixels on a 21 x 24 grid, each pixel 2 units with a 1 unit gap. Four leaf greens, lightest at the top like new growth, over a bark trunk and root base.

| File | Use |
|---|---|
| `docs/brand/grove-mark.svg` | The tree, in colour. The default. |
| `docs/brand/grove-mark-mono.svg` | The tree in one colour (`currentColor`), for places that only take one: leaf on dark, forest on light. |
| `docs/brand/grove-lockup-on-dark.png` | Tree and wordmark, for dark backgrounds (2x). |
| `docs/brand/grove-lockup-on-light.png` | Tree and wordmark, for light backgrounds (2x). |
| `src/main/icon.png`, `icon.ico` | App and installer icon. |

In the app, use the `Logo` component (`$lib/components/ui/logo`), which draws the same pixels.

**Wordmark.** "Grove Bench" in Pixelify Sans, weight 600, to the right of the tree. The tree is about as tall as the text's line, with a gap of about half the tree's width between them.

**Clear space.** Keep at least a third of the tree's height clear on every side.

**Smallest size.** 13px tall on screen (the title bar). Smaller than that, the gaps between pixels close up. At 16px and below (favicons), use the icon files, which are drawn for small sizes.

**Don't:**

- recolour the tree, apart from the one-colour version above
- round the pixels, smooth them, or add outlines, shadows or gradients
- stretch, rotate or crop it
- scale it to sizes that blur the pixels (in SVG, keep `shape-rendering="crispEdges"`)
- put it on a busy or patterned background
- set the wordmark in any other typeface

## Colour

### Palette

The palette comes from the logo and the grove scene: leaves, bark, sky, sun. Names are the keys of `PALETTE` in `brand.ts`.

| Name | Hex | Role |
|---|---|---|
| sprout | `#6ec87a` | Top of the tree |
| leaf | `#5ab868` | **Primary in the dark theme.** Working status. |
| moss | `#4aaa58` | Tree |
| fern | `#3a9a48` | Tree |
| forest | `#257635` | **Primary in the light theme.** Leaf darkened until white text reads on it. |
| canopy | `#091a0d` | Text on a leaf fill |
| bark | `#8a6a4a` | Trunk |
| root | `#6a5040` | Roots |
| sky / skyDeep | `#52adef` / `#1469bc` | Unread status, links (dark / light theme) |
| sun / sunDeep | `#f59e0b` / `#b45309` | Needs you, warnings (dark / light theme) |
| ember / emberDeep | `#f14c4c` / `#c72e0f` | Errors, destructive actions (dark / light theme) |
| cinder | `#250e0d` | Text on an ember fill in the dark theme |

### Neutrals

Two sets of greys, both leaning slightly warm, towards the bench's wood, rather than a stock grey:

- **Night** (`NIGHT`), the dark theme: from `#13110f` (sidebar) to `#f6f5f2` (dialog text).
- **Paper** (`PAPER`), the light theme: from `#fefdfa` (background) to `#221e1a` (strongest text).

Hover and selection use a faint moss tint (`--accent`), so even the quiet parts of the UI lean towards the grove.

### What colour means

Colour is for meaning, not decoration. Each colour has one job:

| Colour | Means | Token |
|---|---|---|
| Brand green | An action you can take (primary buttons, focus, the current choice), and an agent working: the grove growing | `--primary`, `--status-working` |
| Amber (sun) | Needs you: a permission prompt or a question | `--status-attention` |
| Blue (sky) | A thread finished a turn you haven't seen. Also links that leave the app | `--status-unread`, `--link` |
| Red (ember) | Something failed, or an action that destroys something | `--status-error`, `--destructive` |
| Grey | Quiet: ready, sleeping, closed | `--muted-foreground` |

Rules that follow from that:

- **Green acts, blue goes.** A link-style button that does something in the app is primary green. A link that opens a web page or another app is blue.
- **Status colours only through the status tokens** (`bg-status-working`, `text-status-attention`, and so on), never `bg-primary` or a palette colour. Changing what a status looks like is then a one-line edit in `globals.css`.
- **Success and diffs keep Tailwind's green** (`text-green-400`): a copied tick, added lines, a passing check. They mean "done", which brand green doesn't.
- **Dark fills carry dark text.** In the dark theme, primary and destructive fills are bright, so their text is dark (canopy, cinder). White on leaf would be 2.5:1.
- **Text keeps 4.5:1** (WCAG AA) against its background in both themes. The tests check the theme tokens. Fading text with opacity (`text-muted-foreground/50`) usually breaks this, so don't do it for anything people need to read.

## Type

Two typefaces, both bundled with the app (SIL Open Font License) so it looks the same on every machine:

- **JetBrains Mono** for everything: UI, code, terminal. A monospaced UI suits a tool that is mostly code, paths and commands, and lines up columns for free.
- **Pixelify Sans** for brand moments only: the wordmark, empty-state titles, landing page headings. Never body text, buttons, or anything under 16px.

| Token | Size | Use |
|---|---|---|
| `text-micro` | 10px | Counts, badges, key hints |
| `text-caption` | 11px | Secondary details: times, paths |
| `text-xs` | 12px | Default UI text: rows, buttons, menus |
| `text-sm` | 14px | Reading: messages, the prompt |
| `text-base` | 16px | Panel titles, empty-state titles (pixel face) |

Weights: 400 normal, 500 for labels and buttons, 700 for counts. Sentence case everywhere, except the small uppercase section labels.

## Shape and space

- **Square corners.** No border radius anywhere (`--radius: 0`). Square edges match the pixel art. The only round things should be ones that are round in the world.
- **Borders before shadows.** Panels are separated by 1px borders. Only things that float over the page (menus, popovers, toasts) get a shadow.
- **Dense, on a 4px grid.** Tailwind's spacing scale. Rows are usually `px-2 py-1` or `px-3 py-1.5`; panels pad `p-3`.

## Pixel art

The characters, trees, benches and grove are drawn on a pixel grid from `src/renderer/lib/agent-sprite.ts`, `pixel-tree.ts`, `grove-walk.ts` and `context-grove.ts`. The landing page imports the same code, so it never drifts from the app.

- Draw on the grid: whole pixels, no smoothing, no anti-aliased curves.
- Take colours from the brand palette or the scenery palette in `agent-sprite.ts`.
- Art adds to the meaning but never carries it alone. A character's status is in its colour, its pose and its label (`title` and `aria-label`), so it reads without colour and without sight.
- It can be turned off: **Show grove characters** swaps the characters for plain status squares.

## Motion

Small and purposeful. Movement marks something live:

- **Pulse** (fading in and out): working, or waiting for you.
- **Turning square** (`animate-fidget`): writing.
- **Flash**: a thread finished a turn while you were elsewhere.
- Hover and tooltip fades: 150ms or less.

Everything stops when the system asks for reduced motion. The colour still carries the state.

## Voice

Grove Bench talks like a capable colleague: plain, direct and brief. It explains what is happening and what you can do about it, then gets out of the way.

- **Say what happens.** Buttons name their result: "Create PR", "Stop and close", "Switch and send the transcript". Not "OK" or "Submit".
- **Errors say what went wrong and how to fix it.** "settings.json is read-only. Check its permissions and try again." No apologies, no blame, no codes on their own.
- **Use the user-facing names**: Thread, Thread tab, Project (see the Terminology section of CLAUDE.md). Code names like session and repo stay in the code.
- **Plain words.** Write for a smart colleague who is busy. Short sentences. No hype, no exclamation marks, no emoji in the UI.
- **Sentence case** for buttons, labels, menu items and headings.
- **Spelling:** UI text and help pages mostly use American spelling (color, organize) today, and code comments mostly British (colour). Follow the file you're in.
