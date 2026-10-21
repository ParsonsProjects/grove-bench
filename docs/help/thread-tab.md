# Thread Tab

The Thread tab (`Alt+1`) is the primary view for interacting with your agent. It displays the full thread history including messages, tool calls, and permission requests.

## Thread Goal

A box at the top of the Thread tab says what the thread is trying to get done. The agent writes it once, after its first reply, using its background model. A long goal is cut off after two lines; click it to see all of it. Hovering the thread in the sidebar shows the goal too.

- **Edit** (pencil): type your own goal and press `Enter` (`Esc` cancels). A goal you typed is never replaced automatically. Clear the text to remove it.
- **Refresh**: write a new goal from the thread so far, for when the work has moved on. This replaces the current goal, including one you typed, and costs one model call.
- **Hide** (✕): close the box for this thread, which also takes the goal out of its sidebar tooltip. The flag next to the Thread view picker brings it back.

Goals are off until you tick **Show the thread goal** in **Settings > Tending**. Untick it to turn them off again; no goals are written while it is off.

## Message Types

### User Messages
Your messages appear with a green left border. These are the instructions and follow-ups you send to the agent.

Files you attached show above the message text. Click a text file to show or hide its content. Click a PDF or audio file to open it in its default app; any other file is shown in File Explorer instead, so a click never runs a program. Images show as thumbnails; click one to see it full size, and press `Esc` or click outside to close it. Images and files stay when you reopen the thread. They are deleted with the thread, when you `/clear` it, or when you rewind to before the message or tool that showed them.

Hover a message to reveal the rewind icon (**Rewind to this message**). It opens the rewind dialog with that message selected and a preview of everything that would be undone: files go back to how they were just before that message, and the message plus every turn after it are dropped. The message text is placed back in the prompt box so you can rephrase it and try again. Tick **Thread only** in the dialog to keep the files and only reset the thread. In a thread that runs without git there are no checkpoints, so the dialog always resets only the thread and says the files stay as they are. With an agent that can't forget part of a thread (the ACP agents), the dialog says so: the agent starts afresh from that point and won't remember the earlier turns either. The Checkpoints tab (`Alt+3`) offers the same rewind with a full per-file diff.

A checkpoint is taken every time you send a message, before the agent starts working. If one could not be taken (for example a git error in the worktree), a notice appears under the message and Rewind is not offered for it.

### Assistant Responses
The agent's text responses are rendered as markdown with syntax highlighting for code blocks.

When a response shows an image saved in the thread's worktree (for example `![Home page](screenshots/home.png)`), the image appears in the response. A link to a web page, PDF, image, video, audio file, spreadsheet or document in the worktree opens it: a web page in the Preview tab, the rest in their default app. Links to other files, such as source code, do nothing, and paths outside the worktree don't load or open.

Document-like responses — plans, reports, audits, anything with multiple headings, a table, or several code blocks — show a **Focus** button on hover. It opens the response rendered full-width in a slide-out panel, which is easier to read than the chat column (especially in Summary view). Plan-approval prompts have the same button so you can review a proposed plan full-width before approving. Press `Esc` or click outside the panel to close it.

### Tool Calls
When the agent uses tools (editing files, running commands, reading files), each action is shown as a collapsible block. Click to expand and see full details including inputs and outputs.

Common tool types:
- **Edit/Write** — File modifications shown as a diff
- **Bash** — Terminal commands with their output
- **Read** — Files the agent examined
- **Grep/Glob** — File and content searches

When a tool returns images, such as a screenshot from the Preview tab or an MCP browser tool, or an image file the agent read, they show as thumbnails under the tool. Click one to see it full size. When the agent writes an image file itself (an SVG, for example), it shows under the Write too.

### Files Made
When a turn creates or changes files in the worktree that are worth looking at, a **Files made** list appears just before the turn ends. It catches files made any way: a screenshot saved by a script the agent ran, a chart, a PDF or HTML report, a video from a test run. Images show as thumbnails; click one to see it full size. Other files are chips: click a web page to open it in the Preview tab, or a PDF, video, audio file, spreadsheet or document to open it in its default app. If a file is gone when you click it, its chip is greyed out.

The list leaves out source code, files in dependency, cache and compiled output folders (such as `node_modules`, `dist` and `coverage`), web pages the agent edited rather than created, and files outside the worktree (such as a temp folder). It shows up to 24 files and counts the rest. Images are copied when the turn ends, so an older turn keeps showing the image as it was, even after the agent saves a new one with the same name.

### Subagents
When the agent hands work to a subagent (the **Agent** tool), the thread shows one line for it in every view: the subagent's type, its task, how many tool calls it has made, and whether it is still running. The subagent's own messages and tool calls stay out of the thread, so its notes are never mistaken for the agent's reply. Screenshots and other images the subagent's tools returned show under its line. Click the line, or the subagent in the status bar's pending tools or background tasks, to open the subagent's thread in a slide-out panel: the prompt it was given, its notes, its tool calls and its report, with its own **Detailed**, **Summary** and **Focus** picker. A subagent that started another one shows it the same way, with a back arrow to return. Press `Esc` or click outside the panel to close it. In threads recorded before Grove kept subagents' threads, a subagent's work shows in the main thread as it did then, and its panel shows only its result.

### Permission Requests
When the agent wants to perform an action that requires approval, a permission block appears with **Allow**, **Deny**, and a third button that approves every later call of the same kind in this thread. Its label says what it covers: **Allow all commands** for shell commands (any command, not just this one), **Allow all web fetches** for any web address, and **Always allow** plus the tool's name for other tools. These last while the thread is live, through idle sleep, until you close the thread or restart Grove Bench. On a file edit it reads **Allow all edits (Edit mode)**: it switches the thread to Edit mode, so file edits in the worktree, new files included, no longer ask, while commands still do. Switch back in the agent settings (`Alt+M`). Hover the button for details. For file edits, a diff preview is shown so you can review changes before approving.

A request or question nobody answers within 30 minutes is closed, so the agent isn't left waiting forever. The block then says there was no answer, and the agent is told it timed out, so it can try another way or stop. The thread is marked **Needs you** while a request waits, and a desktop notification can tell you (see **Settings**).

### Plan Approval

In **Plan** mode the agent explores and writes a plan instead of changing files. When it is ready, a **plan ready** block shows the plan (**Focus** reads it full-width) and three choices, each explained when you hover it:

- **Approve**: the agent starts making the changes. The thread switches to **Edit** mode, so the plan's file edits don't each ask; commands still do.
- **Approve and start fresh…**: clears this thread's messages and sends the plan as a new first message, so the agent starts with a clean context. It asks you to confirm first. Your files are not changed.
- **Keep planning**: don't start yet. To say what to change, type in the box under the buttons and press **Send**.

### MCP Input Requests
An MCP server can ask you for input while the agent uses one of its tools. A block appears with the server's question. It is either a short form (fill it in and click **Submit**, or **Decline**) or a page to open in your browser, for example to sign in (**Open page**, or **Decline**). Your answers go to that server, so don't type passwords or API keys into a form. If the agent stops or the server gives up waiting, the block closes as cancelled.

### Thinking Blocks
Extended thinking from the agent appears as expandable sections. Click to see the agent's reasoning process.

## Copying and the Right-Click Menu

Hover a code block or a table to reveal its copy icon. A table copies as cells: spreadsheets and documents paste a real table, and places that take plain text get the columns separated by tabs. For the Markdown source, Shift+click the copy icon, or right-click the table and choose **Copy table as Markdown**.

Select text to get **Bookmark** and **To prompt**.

Right-click anything in the thread for a menu of what you can do there. It lists the most specific things first:

- **Selected text**: **Copy**, **Bookmark selection**, **Copy to prompt**
- **A code block, table or link**: **Copy code**, **Copy table**, **Copy table as Markdown**, **Copy link**
- **The message itself**: **Copy message**. Your messages also get **Rewind to this message**, and document-like responses get **Read full-width**. Tool calls offer **Copy command**, **Copy path**, **Copy pattern** or **Copy input**, and **Copy output**.

Text boxes keep their own spell check menu.

## Controls

- **Search** (`Ctrl+F`) — Search through the thread history
- **Thread view** — While the Thread tab is open, the tab shows the current view next to its name, for example **Thread · Summary**, with how many messages it hides when there's room. Click it to pick **Detailed**, **Summary** or **Focus**. A view that hides messages is shown in green. Detailed shows everything. Summary hides thinking blocks and most tool calls. It keeps file edits, commands, tools that returned images (such as a preview screenshot), and tools from MCP servers you added, since those can act outside the project (for example creating a ticket or sending a message). Focus shows only the agent's responses, its questions and your answers, plus images tools returned (without the tool call) and the **Files made** list. In both Summary and Focus, notes the agent writes while it works ("Let me check the config") fold into one line, such as **3 notes while working**; click it to read them. In Summary, an edit or command between notes starts a new line. Its answer at the end of a turn, and anything it writes just before asking you something, stay open. Summary and Focus both keep the one-line entry for each subagent. New threads start in the view set by **Default thread view** in **Settings → General (The grove)**.
- **Scroll** — The view auto-scrolls to the latest message. Scroll up to browse history; new messages will appear at the bottom.
