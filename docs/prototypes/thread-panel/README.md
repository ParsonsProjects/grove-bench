# Thread panel prototypes

Three directions for the Thread tab's message list (`OutputPanel.svelte`), compared with today's. Static HTML only: no app code changes.

**Open it:** `index.html` in any browser. It's one self-contained file (font and screenshots inlined). The bar at the top switches between designs, the live turn's state (Needs you, Working, Failed), Night and Paper, and wide (960px) or narrow (620px). The URL hash keeps your choice, e.g. `index.html#c-working-paper-narrow`.

Every design shows the same sample thread: a short question, a fix with a failed test and a passing retry, and a live turn waiting on a permission. "Current" is a screenshot of the real Thread tab (Summary view, the default) from the demo harness with that same thread. Colours and type are copied from `globals.css` and `brand.ts`.

## What today's list makes hard

- A turn ends with a small `done $0.4100 192.0s` line, so turns run into each other.
- Reads, edits and commands share one left-border row style, so a long turn reads as an even list.
- The final answer has the same weight as the notes written while working.
- A failed test and the run that passed after it aren't linked.

## The three directions

| | A · Turn cards | B · Reader | C · Timeline |
|---|---|---|---|
| Built for | Turn structure | Reading answers | Scanning steps |
| A turn is | A card: prompt, work strip, answer, files and cost | A section: prompt as a heading, one-line work summary, answer | A run of rows on a rail, ending in an answer box |
| The work | One strip: a pixel trail (a square per step) and counts. Click for steps | One sentence: "Worked for 3m 12s. Read 3 files, ... (1 failed)". Click for steps | Every step, one line each, with time since the prompt |
| Older turns | Fold to one line | Stay open | Outline on the right jumps to them |
| Extra | Card edge in the status colour while live | Time and cost in the margin | Filters: answers, edits, commands, failures |
| Weak spot | More boxes than today | Hides the most work | Busiest; answers compete with rows |
| New data needed | None: turns group from each prompt to its result | None | A timestamp on each tool event (only prompts and results have one) |

## Decision

A, with C's failed-then-passed link, built as the Thread tab's Summary view (`TurnCard.svelte`; help in `docs/help/thread-tab.md`, "Turns in Summary"). Detailed and Focus are unchanged.

## My take (before the decision)

A is the strongest base: it fixes turn boundaries and scanning at once, and needs no new data. Two things worth borrowing from C: the failed-then-passed link, and the turn outline once a thread gets long. B's one-sentence summary could be A's narrow-width work strip.

## Open questions

- ~~Should one of these replace Summary?~~ Decided: A replaces Summary; Detailed and Focus stay.
- ~~How far back should turns fold?~~ Decided: turns before the last two fold.
- Does the work strip belong in the sidebar's thread rows too, as a glance at what each agent did?
