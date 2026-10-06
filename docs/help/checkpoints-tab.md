# Checkpoints Tab

The Checkpoints tab (`Alt+3`) lets you track how your files changed turn by turn and rewind to a previous point in the thread. A checkpoint is a snapshot of the worktree taken each time you send a message, before the agent acts on it. You can also start a rewind straight from a message in the Thread tab: hover it and click the rewind icon.

Checkpoints are git commits kept out of your branches, so a thread that runs without git has none: the tab only says it needs git. Rewinding from a message in the Thread tab still rewinds the messages, but files stay as they are.

## Checkpoint List

The left panel shows a numbered list of checkpoints. Each entry includes a brief description of what the agent was about to do at that point, along with `+added`/`−deleted` line counts showing how much that turn changed. Click a checkpoint to preview it.

At the top of the list, **All turns** shows the cumulative diff of everything that changed since the thread started — the full thread diff across every turn.

Click the panel button next to the checkpoint count to fold the list down to a thin rail of turn numbers. Click a number to preview that turn (hover it to see the message), or the icon at the top for **All turns**. The file list next to the diff folds the same way (see the Changes tab help). Both remember whether they were collapsed.

## Diff Preview

When you select a checkpoint, the right panel shows a diff with two modes:

- **This turn** — What that specific turn changed: the difference between this checkpoint and the next one (or the current files, for the latest turn).
- **Since here** — Everything that changed since this checkpoint, which is exactly what a rewind to this point would undo.

## Rewind Options

When you're ready to rewind, you have two choices:

- **Rewind all** — Restores both the files and the thread to the checkpoint state. This is a full undo.
- **Thread only** — Resets only the thread to the checkpoint. Files on disk are left as-is.

A checkpoint whose message is no longer in the thread (one from before a `/clear`, or the target of an earlier rewind) can only have its files restored; the thread is left untouched. Checkpoints from before a `/clear` show a single **Restore files** button in place of the two above.

What the agent remembers afterwards depends on the agent:

- **Claude Agent** keeps its memory of the thread up to the rewind point and genuinely forgets the turns that were rewound away.
- **Other agents** (Gemini CLI, GitHub Copilot CLI, OpenCode and any you add) can't forget part of a thread, so they start a new session from the rewind point. The files and the thread you see are rewound as usual, but the agent no longer remembers any of the thread, including the turns before the rewind point. The thread says so when it happens.

One caveat for every agent: project memory files (the Memory panel) are not rolled back. Notes the agent saved during rewound turns are kept, so it may still recall facts it wrote to memory.

## When to Use Checkpoints

Checkpoints are useful when:

- The agent went down the wrong path and you want to try a different approach
- A series of changes introduced a bug and you want to roll back
- You want to keep file changes but reset the thread context (use **Thread only**)
