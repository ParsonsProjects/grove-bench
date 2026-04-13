# Activity Tab

The Activity tab (`Alt+1`) is the primary view for interacting with your agent. It displays the full conversation history including messages, tool calls, and permission requests.

## Message Types

### User Messages
Your messages appear with a blue left border. These are the instructions and follow-ups you send to the agent.

### Assistant Responses
The agent's text responses are rendered as markdown with syntax highlighting for code blocks.

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
