# Changes Tab

The Changes tab (`Alt+2`) shows the git status of your thread's worktree, letting you review all file modifications the agent has made.

In a thread that runs without git there is nothing to compare against, so the tab only says it needs git. Check the agent's edits in your editor or file explorer.

If git isn't installed, or is older than 2.17, a warning at the top of this tab says so, with **Download Git** and **Re-check**. Grove Bench doesn't warn about it anywhere else: without git, projects are plain folders.

## File Categories

Files are organized into three groups:

- **Staged** — Files added to the git staging area, ready to be committed
- **Changes** — Modified files that haven't been staged yet
- **Untracked** — New files that git isn't tracking yet

## Viewing Diffs

Click any file to see its diff. Two view modes are available:

- **Unified** — Shows changes inline with added lines in green and removed lines in red
- **Side-by-side** — Shows the old and new versions of the file next to each other

## File Search

Use the **Filter files** box at the top of the file list to filter files by name. This is helpful when the agent has modified many files.

## Collapsing the file list

Click the panel button next to **Filter files** to fold the file list down to a thin rail, which gives the diff more room. The rail shows one status letter per file (M, A, D and so on). Click a letter to open that file, or use the arrow keys, and hover it to see the path. Click the panel button at the top of the rail to open the list again. The Changes and Checkpoints tabs remember this separately.

## Edit History

When viewing a file that was modified by the agent during the current turn, an edit count (for example **3 edits**) appears in the diff header. Click it to expand the edit history for that file, showing each individual change the agent made.

## Reverting Changes

Each modified file has a **Revert** button that resets it to its last committed state. Use this if the agent made an unwanted change to a specific file. New (untracked) files show **Discard** instead, which deletes the file. Both ask you to confirm first.
