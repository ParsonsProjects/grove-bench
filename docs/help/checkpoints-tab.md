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

When you're ready to rewind, you have two choices. Each asks first, says what it will discard, and switches the diff to **Since here** when files would change:

- **Rewind all** — Restores both the files and the thread to the checkpoint state. Every change made since is replaced, your own edits included, and files created since are deleted; a copy of them is kept (see below). Ignored files are left alone.
- **Thread only** — Resets only the thread to the checkpoint. Files on disk are left as-is.

Either way, this turn and the ones after it leave the thread, and the checkpoints after this one are deleted. That part can't be undone.

The files can be. Before restoring them, Rewind all and Restore files keep a copy of the files as they are, and the thread shows a line saying so, with **Bring them back**. Each line brings back its own copy, and bringing one back keeps a copy of the files it replaces in turn, so you can always swap back. Copies are kept for as long as the thread. Bring them back waits while the agent is working. If the copy can't be made, nothing is restored; if restoring fails partway, the thread says so and offers the copy from just before.

A commit doesn't stop a rewind: Rewind all still takes the files on disk back, so they then show as changes that undo the commit. The commit itself stays in the branch's history.

A checkpoint whose message is no longer in the thread (one from before a `/clear`, or the target of an earlier rewind) can only have its files restored; the thread is left untouched. It shows a single **Restore files** button in place of the two above.

After a rewind, the agent keeps its memory of the thread up to the rewind point and genuinely forgets the turns that were rewound away. An agent that can't forget part of a thread (the ACP agents) starts afresh instead, without the earlier turns either; the question says so. One caveat: project memory files (the Memory panel) are not rolled back — notes the agent saved during rewound turns are kept, so it may still recall facts it wrote to memory.

## When to Use Checkpoints

Checkpoints are useful when:

- The agent went down the wrong path and you want to try a different approach
- A series of changes introduced a bug and you want to roll back
- You want to keep file changes but reset the thread context (use **Thread only**)
