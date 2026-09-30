# Conversation Tab

The Conversation tab (`Alt+1`) is the primary view for interacting with your agent. It displays the full conversation history including messages, tool calls, and permission requests.

## Message Types

### User Messages
Your messages appear with a blue left border. These are the instructions and follow-ups you send to the agent.

Hover a message to reveal the rewind icon (**Rewind to this message**). It opens the rewind dialog with that message selected and a preview of everything that would be undone: files go back to how they were just before that message, and the message plus every turn after it are dropped. The message text is placed back in the prompt box so you can rephrase it and try again. Tick **Conversation only** in the dialog to keep the files and only reset the conversation. In a conversation that runs without git there are no checkpoints, so the dialog always resets only the conversation and says the files stay as they are. The Checkpoints tab (`Alt+3`) offers the same rewind with a full per-file diff.

A checkpoint is taken every time you send a message, before the agent starts working. If one could not be taken (for example a git error in the worktree), a notice appears under the message and Rewind is not offered for it.

### Assistant Responses
The agent's text responses are rendered as markdown with syntax highlighting for code blocks.

Document-like responses — plans, reports, audits, anything with multiple headings, a table, or several code blocks — show a **Focus** button on hover. It opens the response rendered full-width in a slide-out panel, which is easier to read than the chat column (especially in Summary view). Plan-approval prompts have the same button so you can review a proposed plan full-width before approving. Press `Esc` or click outside the panel to close it.

### Tool Calls
When the agent uses tools (editing files, running commands, reading files), each action is shown as a collapsible block. Click to expand and see full details including inputs and outputs.

Common tool types:
- **Edit/Write** — File modifications shown as a diff
- **Bash** — Terminal commands with their output
- **Read** — Files the agent examined
- **Grep/Glob** — File and content searches

### Permission Requests
When the agent wants to perform an action that requires approval, a permission block appears with **Allow**, **Deny**, and a third button that approves every later call of the same kind in this conversation. Its label says what it covers: **Allow all commands** for shell commands (any command, not just this one), **Allow all web fetches** for any web address, and **Always allow** plus the tool's name for other tools. These last while the conversation is live, through idle sleep, until you stop the conversation or restart Grove Bench. On a file edit it reads **Allow all edits (Edit mode)**: it switches the conversation to Edit mode, so file edits in the worktree, new files included, no longer ask, while commands still do. Switch back in the agent settings (`Alt+M`). Hover the button for details. For file edits, a diff preview is shown so you can review changes before approving.

A request or question nobody answers within 30 minutes is closed, so the agent isn't left waiting forever. The block then says there was no answer, and the agent is told it timed out, so it can try another way or stop. The conversation is marked **Needs you** while a request waits, and a desktop notification can tell you (see **Settings**).

### Plan Approval

In **Plan** mode the agent explores and writes a plan instead of changing files. When it is ready, a **plan ready** block shows the plan (**Focus** reads it full-width) and three choices, each explained when you hover it:

- **Approve**: the agent starts making the changes. The conversation switches to **Edit** mode, so the plan's file edits don't each ask; commands still do.
- **Approve and start fresh…**: clears this conversation's messages and sends the plan as a new first message, so the agent starts with a clean context. It asks you to confirm first. Your files are not changed.
- **Keep planning**: don't start yet. To say what to change, type in the box under the buttons and press **Send**.

### MCP Input Requests
An MCP server can ask you for input while the agent uses one of its tools. A block appears with the server's question. It is either a short form (fill it in and click **Submit**, or **Decline**) or a page to open in your browser, for example to sign in (**Open page**, or **Decline**). Your answers go to that server, so don't type passwords or API keys into a form. If the agent stops or the server gives up waiting, the block closes as cancelled.

### Thinking Blocks
Extended thinking from the agent appears as expandable sections. Click to see the agent's reasoning process.

## Controls

- **Search** (`Ctrl+F`) — Search through the conversation history
- **Conversation view** — The toggle in the status bar shows the current view and cycles through **Summary**, **Focus** and **Detailed**. Detailed shows everything. Summary hides thinking blocks and most tool calls. It keeps file edits, commands, and tools from MCP servers you added, since those can act outside the project (for example creating a ticket or sending a message). Focus shows only the agent's responses, its questions and your answers. New conversations start in the view set by **Default Conversation View** in **Settings → General**.
- **Scroll** — The view auto-scrolls to the latest message. Scroll up to browse history; new messages will appear at the bottom.
