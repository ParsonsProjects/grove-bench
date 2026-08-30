# Changes Tab

The Changes tab (`Alt+2`) shows the git status of your session's worktree, letting you review all file modifications the agent has made.

## File Categories

Files are organized into three groups:

- **Staged** — Files added to the git staging area, ready to be committed
- **Unstaged** — Modified files that haven't been staged yet
- **Untracked** — New files that git isn't tracking yet

## Viewing Diffs

Click any file to see its diff. Two view modes are available:

- **Unified** — Shows changes inline with added lines in green and removed lines in red
- **Side-by-side** — Shows the old and new versions of the file next to each other

## File Search

Use the search bar at the top to filter files by name. This is helpful when the agent has modified many files.

## Edit History

When viewing a file that was modified by the agent during the current turn, an **edits** indicator appears in the diff header. Click it to expand the edit history for that file, showing each individual change the agent made.

## Reverting Changes

Each modified file has a **revert** button that restores it to its original state. Use this if the agent made an unwanted change to a specific file.
