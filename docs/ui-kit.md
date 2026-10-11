# UI kit

The shared tokens and components every Grove Bench screen is built from, and the rules for using them. [BRAND.md](../BRAND.md) covers the why: logo, palette, type, voice.

**See it:** with `npm start` running, open `/ui-kit.html` on the dev server in a browser (`npm start` prints the address, usually `http://localhost:5173`). It draws every token and component with the real code, in the theme your system is set to. It is never bundled into the app.

## Tokens

All defined in `src/renderer/styles/globals.css`, built from `src/shared/brand.ts`. Use them through Tailwind classes; never write a hex value in a component.

### Colour

| Token | Classes | Use |
|---|---|---|
| `--background` | `bg-background` | The window |
| `--card`, `--popover` | `bg-card`, `bg-popover` | Panels, menus, dialogs |
| `--sidebar` | `bg-sidebar` | The sidebar |
| `--muted` | `bg-muted` | Quiet fills: inputs, soft badges, code |
| `--accent` | `bg-accent` | Hover and selected rows (a moss tint) |
| `--border`, `--input` | `border-border`, `border-input` | Panel edges; input edges |
| `--foreground` | `text-foreground` | Body text |
| `--muted-foreground` | `text-muted-foreground` | Secondary text. The faintest text people need to read. |
| `--primary` | `bg-primary`, `text-primary`, `border-primary` | Actions you can take, focus, the current choice |
| `--primary-foreground` | `text-primary-foreground` | Text on a primary fill (dark in the dark theme) |
| `--destructive` | `bg-destructive`, `text-destructive` | Errors, actions that destroy something |
| `--destructive-foreground` | `text-destructive-foreground` | Text on a destructive fill |
| `--link` | `var(--link)` | Links that leave the app |
| `--ring` | `ring-ring` | Focus rings |

### Status

Thread status has its own tokens. Use them for anything that shows a thread's or an agent's state, so a status has one colour everywhere and changing it is a one-line edit:

| Token | Classes | Means |
|---|---|---|
| `--status-working` | `bg-status-working`, `text-status-working` | The agent is working (green) |
| `--status-attention` | `bg-status-attention`, `text-status-attention` | Needs you: a permission prompt or a question (amber) |
| `--status-unread` | `bg-status-unread`, `text-status-unread` | Finished a turn you haven't seen (blue) |
| `--status-error` | `bg-status-error`, `text-status-error` | Something went wrong (red) |

Quiet states (ready, sleeping, closed) are grey: `text-muted-foreground` or `text-neutral-500`.

`AGENT_SPRITES` in `src/renderer/lib/agent-sprite.ts` maps every state to its class and label, and `StatusDot` draws it as a square.

### Type

| Class | Size | Use |
|---|---|---|
| `text-micro` | 10px | Counts, badges, key hints |
| `text-caption` | 11px | Secondary details: times, paths |
| `text-xs` | 12px | Default UI text |
| `text-sm` | 14px | Reading text: messages, the prompt |
| `text-base` | 16px | Panel titles |
| `font-mono` | | JetBrains Mono, the default everywhere |
| `font-pixel` | | Pixelify Sans: wordmark and empty-state titles only, 16px and up |

`text-micro` and `text-caption` set only the font size, like the `text-[10px]` they replace, so the line height comes from the parent.

### Shape

- No border radius (`--radius: 0`). Don't add `rounded-*`.
- 1px borders separate panels. Shadows only on things that float: menus, popovers, toasts (`shadow-xl`).
- Tailwind's 4px spacing scale.

## Components

All in `src/renderer/lib/components/ui/`. Import from the folder's `index.js`:

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
</script>
```

| Component | Use it for | Instead of |
|---|---|---|
| `Button` | Every button. See the variants and sizes below. | A raw `<button>` with hand-written classes |
| `Badge` | Counts, small state labels ("alpha", "read-only"), file kinds | Spans with `border px-1 text-[10px]` |
| `Kbd` | Keyboard shortcuts. `plain` beside the control it opens, `key` in lists of shortcuts | Spans with faded "Ctrl+R" text |
| `Tabs` | A row of tabs that switch panels (bits-ui: real `tab` roles and arrow keys) | Buttons with `border-b-2` |
| `Segmented` | Choosing one of a few views or modes side by side (a radio group) | Joined buttons with an active fill |
| `Notice` | A message that stays in a panel until what it describes changes: a failed save, a missing git identity, a tip | Divs with `bg-destructive/10` or `bg-yellow-500/10` |
| `SectionLabel` | The small uppercase heading over a group of rows | `text-[10px] uppercase tracking-wide` spans |
| `PanelHeader` | The bar along the top of a panel or tab: title left, actions right | `border-b bg-card/50 px-3 py-1.5` divs |
| `Pulse` | A square that shows something is happening: a tool running, a thread working | `w-2.5 h-2.5 bg-primary animate-pulse` spans |
| `Logo` | The pixel tree, with or without the wordmark | Copies of the tree SVG |
| `menuPanel`, `menuItem`, `menuLabel`, `menuSeparator` | Class recipes for hand-built popovers and menus, so they match | Copied popover and row classes |
| `tabTrigger`, `segmentedItem`, `segmentedRoot` | Class recipes for a tab strip or segmented control that can't use the component (the workspace tabs, whose shortcuts and panels live elsewhere). Prefer `Tabs` and `Segmented`, which bring the right roles and arrow keys. | Copied tab and option classes |
| `Dialog`, `Select`, `Command`, `Checkbox`, `Input`, `Textarea`, `Label`, `Separator` | As before (shadcn-svelte on bits-ui) | |

### Button

| Variant | Use |
|---|---|
| `default` | The main action in a dialog or panel. One per view. |
| `secondary` | Other actions next to it |
| `outline` | A neutral bordered action |
| `subtle` | Toolbar and status-bar actions: bordered, muted text |
| `quiet` | Icon buttons and text that only brightens on hover |
| `ghost` | Like quiet, with a hover fill |
| `outline-primary` | A secondary action that should still stand out |
| `outline-success` | Allowing or approving what the agent asked for |
| `outline-destructive`, `destructive` | Actions that delete or discard. Use the filled one only in a confirmation. |
| `link` | An action inside a sentence ("Try again") |

| Size | Height | Use |
|---|---|---|
| `2xs` | 20px | Status bar, inline actions, notices |
| `xs` | 24px | Toolbars, panel headers, secondary dialog actions |
| `sm` | 32px | Dialog footers |
| `default` | 36px | Forms and first-run screens |
| `icon-2xs`, `icon-xs`, `icon-sm`, `icon` | 20, 24, 32, 36px square | Icon-only buttons. Give them an `aria-label`. |
| `inline` | Text height | A button in a line of text |

A disabled `Button` still gets hover events, so its `title` tooltip can say why it is disabled.

### Badge

`tone`: `neutral`, `muted`, `primary`, `info`, `success`, `warning`, `danger`, `accent`, `highlight`. `variant`: `outline` (default), `soft` (tinted fill) or `solid` (counts only; neutral, muted, primary and danger). Add `count` for numbers.

```svelte
<Badge tone="warning">alpha</Badge>
<Badge tone="primary" variant="solid" count>4</Badge>
```

### Notice

`tone`: `info`, `success`, `warning`, `danger`, `neutral`. Errors are announced at once (`role="alert"`); other tones wait their turn (`role="status"`).

```svelte
<Notice tone="danger" title="Couldn't save settings">
  {#snippet actions()}<Button size="2xs" variant="subtle" onclick={retry}>Try again</Button>{/snippet}
  <p>settings.json is read-only. Check its permissions and try again.</p>
</Notice>
```

## Rules

1. **Reach for the kit first.** If what you need isn't here and the pattern turns up a third time, add it to the kit (with a test in `ui-kit.svelte.test.ts` and an example on `/ui-kit.html`) rather than copying it again.
2. **No arbitrary font sizes** (`text-[10px]`). Use the type scale.
3. **Status colours only through `status-*` tokens.** Never `bg-primary` or `bg-green-400` to mean a status.
4. **Green acts, blue goes.** Primary green for actions in the app; blue (`--link`, `text-blue-400`) for links that open a page or another app.
5. **Keep text readable.** Don't fade text below `text-muted-foreground` (`/40`, `/50`, `/60`) for anything people need to read: it drops under 4.5:1.
6. **Every Tailwind palette shade needs a light-theme value.** A component that uses `text-green-400` needs `--color-green-400` in the light block of `globals.css`; `light-theme.test.ts` fails otherwise.
7. **Square.** No `rounded-*`, no round spinners. `Pulse` with `motion="spin"` is the turning square.
8. **Icons are Lucide** (`@lucide/svelte`), stroke 2: `size-3` (12px) next to `text-xs`, `size-3.5` in `xs` buttons, `size-4` elsewhere. Brand glyphs (the tab icons, the characters) are pixel art.
9. **Import `tv` from `$lib/utils.js`**, not `tailwind-variants`. It knows the theme's font sizes; the stock one drops `text-micro` when a text colour follows it.
10. **Motion stops for reduced motion.** `animate-pulse` and `animate-fidget` already do (`globals.css`); anything new needs the same.

## Adoption

The kit is new, and most of the app was built before it. What already uses it:

- Theme tokens, status tokens, the type scale and the bundled fonts: everywhere.
- `Button`: about 105 places, mostly dialogs and settings.

Still to move over, by count (from a survey when the kit was made):

| Pattern | About | Move to |
|---|---|---|
| Raw `<button>` with hand-written classes | 275 | `Button` with a variant and size |
| Popovers and menus built by hand | 9 implementations | `menuPanel` and `menuItem` now, a shared Popover component later |
| Tab strips and segmented controls | 8 | `Tabs`, `Segmented` |
| Inline error and warning boxes | 10 | `Notice` |
| Uppercase section labels | 31 | `SectionLabel` |
| Badges and count chips | 20 | `Badge` |
| Key hints | 12 | `Kbd` |
| "Working" squares | 10 | `Pulse` |
| Faded text below muted (`/40` to `/60`) | many | `text-muted-foreground` |
| The rounded update pill (`UpdateNotification`) | 1 | Square, as everything else |

Move a screen at a time, and check it on `/ui-kit.html` and in the app in both themes.
