# Sidebar & Projects

The sidebar on the left has three sections. **Threads** is the live working set: every thread that is running, working, waiting on you, or sleeping, across all projects. **Groups** lists threads that belong to one piece of work, usually in different projects. **Projects** lists each project (a folder, usually a git repository) with all of its threads, where closed threads can be reopened, deleted, or cleaned up.

## Projects

Each project you have added appears as a group under **Projects**. Today a project is a single folder: a git repository, or a plain folder used without git (see Getting Started). Its name is shown with a colored accent unique to that project.

Threads within a project are listed below the project name, including the ones that are also under **Threads**; click either row to open it. If multiple threads share the same branch, they are listed together under that branch name. Click the branch name to fold them.

To remove a project, hover its header and click the bin. Grove Bench asks first and says what goes with it: every thread in the project and its copy of the project (worktree). It warns you when any of them is still running (its agent will be stopped) or has uncommitted changes. You can also delete their branches, and it warns you when a branch has commits its base branch doesn't. The project folder itself is never touched.

## Groups

A group is a few threads that belong to one piece of work, usually one per project. For example, an API change in one project and the web change that uses it in another. Each thread still runs in its own project with its own agent, branch and project instructions. The group only lists them together, so you can see how the whole piece of work is going.

- **Start a group**: right-click a thread and choose **New Group…**, or click **+** next to the **Groups** heading. The heading shows once you have more than one project. Starting a group from the heading opens a new thread, and the group is made when you send its first message.
- **Add a thread**: right-click it and choose **Add to** the group, or click **+** on the group's header to start a new one in it. A new one opens in a project the group has nothing in yet, and starts on the same branch name as the others, so the work has one branch name in every project. If the project already has that branch, the thread continues on it, unless something else has it checked out (another thread, or the project folder itself): then Grove Bench says so and you pick another name. You can change the project or branch before you send the first message, or click **✕** next to the group's name at the bottom of the message box to start it outside the group. Starting a new thread from a project's **+** instead also takes it out of the group.
- **Leave a group**: right-click the thread and choose **Remove from** the group. A thread is in at most one group, so **Move to** puts it in another.
- **Finish**: right-click the group's header and choose **Close all threads**, which closes each of its open threads (see Closed threads below). **Rename group** is there too. **Ungroup** (also the two-box button on the header) removes the group and keeps its threads.

Groups are short-lived. A group goes away when its last thread leaves it or is deleted. A grouped thread shows its group's name on its second line under **Threads** and **Projects**. Groups don't share memory, skills or settings: those still belong to each project.

## Thread List

Each thread in the sidebar shows:

- **Status dot** — A colored indicator showing the thread's current state (see [Thread States](session-states.md)). With **Show grove characters** on (Settings → General (The grove), on by default), a small pixel agent shows the state instead
- **Thread name** — Either the branch name or a custom name you've assigned. It has the first line to itself
- **Second line**: its group, if it is in one. Under **Threads**, which project it belongs to (when you have more than one), then what the agent is doing or last said
- **Active indicator** — The currently selected thread is highlighted

Click a thread to switch to it. The workspace will show that thread's activity, changes, and terminal. Click the open thread again to deselect it and go back to the landing screen, or to your new thread if you have one being written.

## Collapsing the sidebar

Click the panel button next to the search box to fold the sidebar down to a thin rail. The rail shows one status dot (or grove character) per open thread, and you can click one to switch to it (click the open one again to deselect it) or right-click it for the context menu. Hover a dot to see its name, and its goal when goals are on. Above them, a **+** starts a new thread (once you have one, it shows as a dashed square for the draft). The rail also keeps search, bookmarks, memory, skills, clean-up and settings. To add a project, open the sidebar. Projects and the filters are only in the full sidebar, so the rail always lists every open thread. Click the panel button at the top of the rail to open the sidebar again. Grove Bench remembers whether it was collapsed.

## Folding Groups and Projects

Click the **Groups** or **Projects** heading to fold that section down to just its heading, and click it again to open it. A folded section at the end of the list moves to the bottom of the sidebar. While folded, its heading shows the same counts as a project header, so you can still see what needs you. Grove Bench remembers which sections are folded.

When a section is further down than you have scrolled, its heading stays pinned to the bottom of the sidebar, so you can always see it's there. If you open a folded section from there, the sidebar scrolls up to it.

## Filters

Above the thread lists, chips let you narrow the sidebar to what matters right now. Each shows a count. The first four are states, and a thread is in at most one of them:

- **Needs you**: the agent is waiting on a permission or a question
- **Working**: a turn is in progress, a background agent (a subagent or workflow) is still running after one, or the thread is starting up
- **Unread**: the agent finished a turn (or a PR alert arrived) while you were in another thread, or you marked it unread
- **Idle**: open and quiet, ready or asleep. Closed and red threads come under none of the four

The last, **To do**, lists the threads you flagged to come back to (see below), whatever their state. So a thread can count under **Working** and **To do** at once. While it's on, **Threads** lists every flagged thread, closed ones too, so none hides in a folded project.

Click a chip to show only those threads, and click it again to show them all. When the sidebar is narrow the chips show just their dot and count; hover one for its name. **Name** and **Age** next to the Threads heading set the order of both lists.

The same counts (except Idle) appear on each project header, so you can see at a glance which project has agents waiting on you, or threads to come back to.

## Coming back to a thread

Right-click a thread and choose **Mark as To Do** to keep track of something you want to follow up. A ring shows next to its name, and the **To do** chip lists every flagged thread. The flag stays when you open the thread, close it or restart Grove Bench. It goes only when you right-click and choose **Clear To Do**, or delete the thread.

**Mark as Unread** is the lighter option for an open thread: it shows as unread (green) until you next open it, the same as when its agent finishes while you're elsewhere. Marking the thread you have open keeps it unread until you open it again. **Mark as Read** clears it without opening the thread. Closed threads don't offer Mark as Unread, as closing one counts as dealing with it.

## Closed threads

To put a thread aside, whether it's done or you'll come back to it later, right-click it and choose **Close Thread**, or hover it and click the **✕**. This shuts down its agent, background commands and terminal, including any dev servers they started, and takes it off the **Threads** list. If it's still working (in the middle of a turn, or a background agent is running), Grove Bench asks first, as closing stops that work. Under **Projects** it shows as **Closed**. Its copy of the project and its branch are kept, so you can go back to it: press `Ctrl+R` to find it, or `Ctrl+Shift+T` for the last one you closed. Opening it starts its agent again and puts it back under **Threads**.

## Context Menu

Right-click a thread to access:

- **Mark as To Do** or **Clear To Do**: flag the thread to come back to, or clear the flag (see Coming back to a thread above)
- **Mark as Unread** or **Mark as Read**: show an open thread as unread until you next open it, or clear that
- **Rename** — Give the thread a custom display name
- **Open Folder** — Open the worktree directory in your file explorer
- **Export Thread…**: save the thread to a file. As Markdown it has the messages and a line for each tool call, without tool output, thinking or the contents of attached files; pick JSON in the save dialog for every event the thread saved
- **Close Thread** — Shut down a live thread's agent and take it off the Threads list, but keep the thread, so you can pick it up again later
- **New Group…**, **Add to**, **Move to**, **Remove from**: put the thread in a group, or take it out (see Groups above)
- **Delete Thread**: remove the thread and its copy of the project, and optionally its branch. It warns first when files have uncommitted changes, or, if you also delete the branch, when the branch has commits its base branch doesn't have

Hovering a row shows its full name and, when goals are on (see [Thread tab](thread-tab.md)), what the thread is trying to get done. Hovering it, or moving to it with Tab, also shows a quick button: an **✕** to close an open thread (it asks first if the agent is mid-turn), or a bin to delete a closed one (it always asks first).

Closing or deleting the thread you have open takes you back to the landing screen. It doesn't open another thread in its place.

Grove Bench also starts on the landing screen. The threads you had open are listed there and under **Threads**, and none of them starts its agent until you open it.

## Starting threads and adding projects

- **New thread**: always the first row under **Threads**. Click it to start a draft in the open thread's project (or press `Ctrl+N`). The draft then takes its place until you send its first message or discard it. Each project row also has its own **+**, which starts a thread in that project
- **+** next to the **Projects** heading: add a project

## Bottom Controls

At the bottom of the sidebar you'll find:

- **Project Memory** (brain icon) — Open the project memory panel
- **Skills** (wand icon): open the Skills drawer, on the open thread's skills, or on **Scheduled** when no thread is open (see [Skills](status-bar.md#skills))
- **Clean up old threads** (broom icon) — Review and remove closed threads inactive past a chosen cutoff. Removal deletes the worktree (branches are kept unless you opt in). Threads with uncommitted changes are flagged and left unselected, so nothing with unsaved work is removed unless you explicitly tick it. **Select all** says how many it leaves out for that reason. Threads marked To do show **to do** and are left out the same way, by **Select all** and **Select merged** too. If you tick one yourself, the confirmation says so. When the GitHub CLI is available, each row also shows the state of the pull request on its branch (open, draft, merged, closed or none), and **Select merged** ticks only the threads whose PR has been merged. Running threads are never listed.
- **Settings** (gear icon, or `Ctrl+,`) — Open application settings

You can also access **Help** (? icon) from the title bar, next to the window controls in the top right.
