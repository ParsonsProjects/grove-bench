# Sidebar & Repositories

The sidebar on the left has two sections. **Conversations** is the live working set: every session that is running, working, or waiting on you, across all repositories. **Projects** lists each repository with all of its sessions, where stopped sessions can be resumed, destroyed, or cleaned up.

## Projects

Each repository you've added appears as a group under **Projects**. The repository name is shown with a colored accent unique to that repo, making it easy to distinguish between projects.

Sessions within a repo are listed below the repo name. If multiple sessions share the same branch, they are grouped together under that branch name.

## Session List

Each session in the sidebar shows:

- **Status dot** — A colored indicator showing the session's current state (see [Session States](session-states.md))
- **Session name** — Either the branch name or a custom name you've assigned
- **Active indicator** — The currently selected session is highlighted

Click a session to switch to it. The workspace will show that session's activity, changes, and terminal.

## Filters

Above the session lists, four chips let you narrow the sidebar to what matters right now. Each shows a count, and a session belongs to exactly one:

- **Needs you** — the agent is waiting on a permission or a question
- **Working** — a turn is in progress
- **Unread** — the agent finished a turn (or a PR alert arrived) while you were in another session
- **All** — everything

The same three counts appear on each repository header, so you can see at a glance which project has agents waiting on you.

## Completed sessions

When a piece of work is done, right-click the session and choose **Mark Completed**. Completed sessions are hidden from both lists and a **Show completed** toggle appears next to the Projects header. They show a check mark when visible, can be reopened from the context menu, and reopen automatically if you send them another message.

## Context Menu

Right-click a session to access:

- **Rename** — Give the session a custom display name
- **Mark Completed** / **Reopen** — Hide a finished session, or bring it back
- **Open Folder** — Open the worktree directory in your file explorer
- **Destroy** — Remove the session and optionally delete its branch

## Bottom Controls

At the bottom of the sidebar you'll find:

- **+ Repository** and **+ Agent** — Add a repository / create a new agent session (side by side)
- **Memory** (brain icon) — Open the project memory panel
- **Clean up old sessions** (broom icon) — Review and remove stopped sessions inactive past a chosen cutoff. Removal deletes the worktree (branches are kept unless you opt in). Sessions with uncommitted changes are flagged and left unselected, so nothing with unsaved work is removed unless you explicitly tick it. Running sessions are never listed.
- **Settings** (gear icon) — Open application settings

You can also access **Help** (? icon) from the title bar, next to the window controls in the top right.
