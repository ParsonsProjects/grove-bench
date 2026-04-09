# Checkpoints Tab

The Checkpoints tab (`Alt+3`) lets you rewind your session to a previous point in the conversation. Each checkpoint represents a snapshot taken before a significant agent action.

## Checkpoint List

The left panel shows a numbered list of checkpoints. Each entry includes a brief description of what the agent was about to do at that point. Click a checkpoint to preview it.

## Diff Preview

When you select a checkpoint, the right panel shows a diff of what would change if you rewind to that point — specifically, the file changes that would be undone.

## Rewind Options

When you're ready to rewind, you have two choices:

- **Rewind All** — Restores both the files and the conversation to the checkpoint state. This is a full undo.
- **Conv. Only** — Resets only the conversation to the checkpoint. Files on disk are left as-is.

## When to Use Checkpoints

Checkpoints are useful when:

- The agent went down the wrong path and you want to try a different approach
- A series of changes introduced a bug and you want to roll back
- You want to keep file changes but reset the conversation context (use Conv. Only)
