# Changes Tab

The Changes tab (`Alt+2`) shows the git status of your thread's worktree, letting you review all file modifications the agent has made.

In a thread that runs without git there is nothing to compare against, so the tab only says it needs git. Check the agent's edits in your editor or file explorer.

If git isn't installed, or is older than 2.17, a warning at the top of this tab says so, with **Download Git** and **Re-check**. Grove Bench doesn't warn about it anywhere else: without git, projects are plain folders.

## Branch and Uncommitted

The toggle at the top of the file list picks what the tab compares:

- **Branch** (the default): everything changed on the thread's branch since it left the base branch, committed or not, like a pull request. The line under the toggle names the base (for example **vs main**). When the branch has an open pull request, the base is the one the PR merges into. Otherwise it's the base branch in Settings, or your project's default branch.
- **Uncommitted**: only what isn't committed yet. This is where you stage files and commit.

If there's no branch to compare against yet (for example, before the first commit), the tab opens on **Uncommitted** instead. The **±** count next to a thread in the sidebar always counts uncommitted files.

## File Categories

Files are organized into these groups:

- **Conflicts**: Files a merge, rebase or cherry-pick left in conflict (only when there are some). They come first, marked **U** in amber
- **Staged**: Files added to the git staging area, ready to be committed
- **Changes**: Modified files that haven't been staged yet
- **Untracked**: New files that git isn't tracking yet

## Viewing Diffs

Click any file to see its diff. Two view modes are available:

- **Unified** — Shows changes inline with added lines in green and removed lines in red
- **Side-by-side** — Shows the old and new versions of the file next to each other

## File Search

Use the **Filter files** box at the top of the file list to filter files by name. This is helpful when the agent has modified many files.

## Collapsing the file list

Click the panel button next to **Filter files** to fold the file list down to a thin rail, which gives the diff more room. The rail shows one status letter per file (M, A, D, U for a conflict, and so on). Click a letter to open that file, or use the arrow keys, and hover it to see the path. Click the panel button at the top of the rail to open the list again. The Changes and Checkpoints tabs remember this separately.

## Edit History

When viewing a file that was modified by the agent during the current turn, an edit count (for example **3 edits**) appears in the diff header. Click it to expand the edit history for that file, showing each individual change the agent made.

## Reviewing the PR

When the branch checked out in the thread has an open pull request, the Branch view shows **Review changes…** under the file list. It opens a dialog where you write a summary and pick:

- **Comment**: feedback without approving
- **Approve**: you're happy for it to merge
- **Request changes**: it needs changes before it can merge

Comment and Request changes need a summary. The review is posted to GitHub with your `gh` account. **Approve** only works when your checkout is at the PR's latest commit, so the approval covers what you reviewed: push or pull first if they differ.

Line comments you wrote in the Branch view go with the review, each on its line in the PR. GitHub only takes comments on lines in the PR's diff, so a comment is quoted in the summary instead when its line isn't in the diff, or when the line reads differently in the PR than when you commented (for example, the code moved since). Once posted, those comments leave the Changes tab. With line comments waiting, **Post to PR #…** in the comment bar opens the same dialog.

GitHub doesn't let you approve or request changes on your own PR, so for a PR your `gh` account opened, only **Comment** is offered.

## Reverting Changes

Each modified file has a **Revert** button that resets it to its last committed state. Use this if the agent made an unwanted change to a specific file. New (untracked) files show **Discard** instead, which deletes the file. Both ask you to confirm first. Reverting a file that is new to git (staged as new, or added with `git add -N`) deletes it too, and the confirmation says so.

Reverting a renamed file undoes the rename: the old name comes back and the new one is deleted. If something else is at the old name by then, such as a new file or a folder, Revert stops and says so rather than overwrite it. Move it, then try again.

A file with a merge conflict has no **Revert**: resolve the conflict, or abort what stopped on it (see below).

## Resolving conflicts

When the agent (or you, in the terminal) merges, rebases or cherry-picks and git stops on a conflict, the files it couldn't merge are listed under **Conflicts**, in both views. The diff header says how each one conflicts, in git's words (for example **Conflict: both modified**, or **deleted by them**). In **Uncommitted**, the diff shows the file as it is now against the commit checked out (HEAD), so the conflict markers git wrote into it (`<<<<<<<`, `=======` and `>>>>>>>`) show as added lines, in amber. Next to each marker, the diff names the side it starts or ends in plain words, since git's own can mislead: in a rebase git calls the branch you're rebasing onto **HEAD**, so that side reads **main, the branch you're rebasing onto**, and the other **your commit**. In a merge they read **feat, yours** and **coming in**. **Branch** compares it with the base branch, as it does every file.

While it's stopped, an amber strip across the top of the tab says what is under way and what's left, for example **Rebasing feat onto main, step 1 of 2. Resolve 1 conflict, then continue.** The status bar shows the same next to the branch (**rebasing 1/2**), whichever tab you're on; click it to come here.

Edit the file to keep what you want and remove the markers, or ask the agent to. Then, in **Uncommitted**, click **Mark resolved**. That stages the file, which is how git marks a conflict resolved. It isn't done while the file still has conflict markers, so a file isn't marked resolved with them still in it. Once every conflict is resolved, finish:

- **A merge** finishes with a commit. The commit box is filled in with git's message for it ("Merge branch 'main' into feat"), and **Commit** waits until no conflicts are left. If every conflict went your branch's way, so nothing is staged, the box still shows, as **Commit merge** (not while a change is left unstaged, which the commit would leave out). If the merge ends some other way, git's message is taken out of the box again, unless you edited it.
- **A rebase, cherry-pick or revert** finishes with **Continue** in the strip, which keeps each commit's own message. There's no commit box meanwhile, as a commit would add another one. A rebase may stop again at a later commit's conflicts: the strip then shows the next step. A commit whose resolution leaves no change is dropped, as git's rebase does. A rebase won't continue while files have changes that aren't staged: stage them or undo them first. When picking several commits, if git stopped before it could start the next one (a file in the way, say), Continue won't go on, as git would leave that commit out: abort and start again.

To give up instead, click **Abort** in the strip, which asks first: the branch goes back to how it was before it started, and the conflicts you resolved are lost. If a commit was made by hand part way through picking several, git won't take the branch back, so Abort says so: continue, or stop where it is with `git cherry-pick --quit` in the terminal. Continue and Abort wait while the agent is working, since it may be the one running it.
