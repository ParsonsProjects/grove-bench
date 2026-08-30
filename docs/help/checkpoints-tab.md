# Checkpoints Tab

The Checkpoints tab (`Alt+3`) lets you track how your files changed turn by turn and rewind your session to a previous point in the conversation. Each checkpoint represents a snapshot taken before a significant agent action.

## Checkpoint List

The left panel shows a numbered list of checkpoints. Each entry includes a brief description of what the agent was about to do at that point, along with `+added`/`−deleted` line counts showing how much that turn changed. Click a checkpoint to preview it.

At the top of the list, **All turns** shows the cumulative diff of everything that changed since the session started — the full thread diff across every turn.

## Diff Preview

When you select a checkpoint, the right panel shows a diff with two modes:

- **This turn** — What that specific turn changed: the difference between this checkpoint and the next one (or the current files, for the latest turn).
- **Since here** — Everything that changed since this checkpoint, which is exactly what a rewind to this point would undo.

## Rewind Options

When you're ready to rewind, you have two choices:

- **Rewind All** — Restores both the files and the conversation to the checkpoint state. This is a full undo.
- **Conv. Only** — Resets only the conversation to the checkpoint. Files on disk are left as-is.

After a rewind, the agent keeps its memory of the conversation up to the rewind point and genuinely forgets the turns that were rewound away. One caveat: project memory files (the Memory panel) are not rolled back — notes the agent saved during rewound turns are kept, so it may still recall facts it wrote to memory.

## When to Use Checkpoints

Checkpoints are useful when:

- The agent went down the wrong path and you want to try a different approach
- A series of changes introduced a bug and you want to roll back
- You want to keep file changes but reset the conversation context (use Conv. Only)
