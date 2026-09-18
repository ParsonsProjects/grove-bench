# Activity Tab

The Activity tab (`Alt+1`) is the primary view for interacting with your agent. It displays the full conversation history including messages, tool calls, and permission requests.

## Message Types

### User Messages
Your messages appear with a blue left border. These are the instructions and follow-ups you send to the agent.

Hover a message to reveal **Rewind**. It opens the rewind dialog with that message selected and a preview of everything that would be undone: files go back to how they were just before that message, and the message plus every turn after it are dropped. The message text is placed back in the prompt box so you can rephrase it and try again. Tick **Conversation only** in the dialog to keep the files and only reset the conversation. The Checkpoints tab (`Alt+3`) offers the same rewind with a full per-file diff.

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
- **Search/Glob** — File and content searches

### Permission Requests
When the agent wants to perform an action that requires approval, a permission block appears with **Allow**, **Allow Always**, and **Deny** buttons. For file edits, a diff preview is shown so you can review changes before approving.

### Thinking Blocks
Extended thinking from the agent appears as expandable sections. Click to see the agent's reasoning process.

## Controls

- **Search** (`Ctrl+F`) — Search through the conversation history
- **Detail Toggle** — Switch between full detail and summary mode. Summary mode hides thinking blocks and less important tool calls, showing only edits, writes, and bash commands.
- **Scroll** — The view auto-scrolls to the latest message. Scroll up to browse history; new messages will appear at the bottom.
