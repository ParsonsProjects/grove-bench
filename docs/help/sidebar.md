# Sidebar & Projects

The sidebar on the left has two sections. **Conversations** is the live working set: every conversation that is running, working, waiting on you, or sleeping, across all projects. **Projects** lists each project (a folder, usually a git repository) with all of its conversations, where stopped conversations can be resumed, deleted, or cleaned up.

## Projects

Each project you have added appears as a group under **Projects**. Today a project is a single folder: a git repository, or a plain folder used without git (see Getting Started). Its name is shown with a colored accent unique to that project.

Conversations within a project are listed below the project name. If multiple conversations share the same branch, they are grouped together under that branch name.

## Conversation List

Each conversation in the sidebar shows:

- **Status dot** — A colored indicator showing the conversation's current state (see [Conversation States](session-states.md)). With **Show grove characters** on (Settings > General, on by default), a small pixel agent shows the state instead
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
- **Stop** — Shut down a live conversation's agent but keep the conversation, so you can pick it up again later
- **Delete Conversation**: remove the conversation and its copy of the project, and optionally its branch. It warns first when files have uncommitted changes, or, if you also delete the branch, when the branch has commits its base branch doesn't have

Stopping or deleting the conversation you have open takes you back to the landing screen. It doesn't open another conversation in its place.

Grove Bench also starts on the landing screen. The conversations you had open are listed there and under **Conversations**, and none of them starts its agent until you open it.

## Bottom Controls

At the bottom of the sidebar you'll find:

- **+ Project** and **+ Conversation** — Add a project / start a new conversation in the open conversation's project (side by side). Each project row also has its own **+**, which starts a conversation in that project
- **Project Memory** (brain icon) — Open the project memory panel
- **Clean up old conversations** (broom icon) — Review and remove stopped conversations inactive past a chosen cutoff. Removal deletes the worktree (branches are kept unless you opt in). Conversations with uncommitted changes are flagged and left unselected, so nothing with unsaved work is removed unless you explicitly tick it. When the GitHub CLI is available, each row also shows the state of the pull request on its branch (open, draft, merged, closed or none), and **Select merged** ticks only the conversations whose PR has been merged. Running conversations are never listed.
- **Settings** (gear icon) — Open application settings

You can also access **Help** (? icon) from the title bar, next to the window controls in the top right.
