# Sidebar & Projects

The sidebar on the left has two sections. **Conversations** is the live working set: every conversation that is running, working, or waiting on you, across all projects. **Projects** lists each project (a git repository) with all of its conversations, where stopped conversations can be resumed, destroyed, or cleaned up.

## Projects

Each project you have added appears as a group under **Projects**. Today a project is a single git repository. Its name is shown with a colored accent unique to that project.

Conversations within a project are listed below the project name. If multiple conversations share the same branch, they are grouped together under that branch name.

## Conversation List

Each conversation in the sidebar shows:

- **Status dot** — A colored indicator showing the conversation's current state (see [Conversation States](session-states.md))
- **Conversation name** — Either the branch name or a custom name you've assigned
- **Active indicator** — The currently selected conversation is highlighted

Click a conversation to switch to it. The workspace will show that conversation's activity, changes, and terminal.

## Filters

Above the conversation lists, four chips let you narrow the sidebar to what matters right now. Each shows a count, and a conversation belongs to exactly one:

- **Needs you** — the agent is waiting on a permission or a question
- **Working** — a turn is in progress
- **Unread** — the agent finished a turn (or a PR alert arrived) while you were in another conversation
- **All** — everything

The same three counts appear on each project header, so you can see at a glance which project has agents waiting on you.

## Completed conversations

When a piece of work is done, right-click the conversation and choose **Mark Completed**. Completed conversations are hidden from both lists and a **Show completed** toggle appears next to the Projects header. They show a check mark when visible, can be reopened from the context menu, and reopen automatically if you send them another message.

## Context Menu

Right-click a conversation to access:

- **Rename** — Give the conversation a custom display name
- **Mark Completed** / **Reopen** — Hide a finished conversation, or bring it back
- **Open Folder** — Open the worktree directory in your file explorer
- **Destroy** — Remove the conversation and optionally delete its branch

## Bottom Controls

At the bottom of the sidebar you'll find:

- **+ Project** and **+ Agent** — Add a project / start a new conversation (side by side)
- **Memory** (brain icon) — Open the project memory panel
- **Clean up old conversations** (broom icon) — Review and remove stopped conversations inactive past a chosen cutoff. Removal deletes the worktree (branches are kept unless you opt in). Conversations with uncommitted changes are flagged and left unselected, so nothing with unsaved work is removed unless you explicitly tick it. When the GitHub CLI is available, each row also shows the state of the pull request on its branch (open, draft, merged, closed or none), and **Select merged** ticks only the conversations whose PR has been merged. Running conversations are never listed.
- **Settings** (gear icon) — Open application settings

You can also access **Help** (? icon) from the title bar, next to the window controls in the top right.
