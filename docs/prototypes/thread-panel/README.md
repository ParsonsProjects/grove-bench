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

## Round 2: after looking at Claude and Grok

**Open it:** `round-2.html`, the same way as `index.html` (the hash keeps your choice, e.g. `round-2.html#f-working-night-wide`). "Current build" is a screenshot of the Summary view as built on this branch, with the same sample thread.

| | D · Focus line | E · Grouped activity | F · Work block |
|---|---|---|---|
| Based on | Claude Code's `/focus`: last prompt, a one-line summary of tool calls with edit diffstats, the final response ([docs](https://code.claude.com/docs/en/fullscreen)) | Claude Code desktop's Normal view, "Tool calls collapsed into summaries" ([docs](https://code.claude.com/docs/en/desktop)), and merged repeats like "Called slack 3 times" ([docs](https://code.claude.com/docs/en/interactive-mode)) | claude.ai's expandable "Thinking" section with a timer above the answer ([help](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)) and Grok's "Thought for 24 seconds" and sources panel ([xAI](https://x.ai/news/grok-4-fast), [release notes](https://grok.com/release-notes)); not checked first-hand |
| A turn is | Prompt, one summary line, answer. No box | Prompt, a verb line per step ("Read 3 files", "Edited a.ts +8 −1"), answer, a "Done in" line | Prompt, one closed block of steps, answer, changed files as chips |
| The work | Behind the summary line | Always shown, repeats merged | Behind the block's header, on a timeline |
| While live | Last five steps | Last five lines | Only the current step, under a ticking timer |
| Weak spot | Weaker turn edges; files are only a count | Long turns stay long | One step at a time while live; two boxes when a permission waits |

My take: D fixes "too boxy" with the least change from the build. F's live line (current step and timer) is calmer than the last five steps and could pair with D.
