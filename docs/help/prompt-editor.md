# Prompt Editor

The prompt editor at the bottom of the workspace is where you type instructions for the agent.

## Sending Messages

Type your message and press **Enter** to send. The agent will begin processing immediately.

For multi-line messages, use **Shift+Enter** to add a new line without sending.

## File References

Type `@` followed by a filename to open the file picker. Select a file to reference it in your message — the agent will have that file's content as context.

## Slash Commands

Type `/` to see available commands:

- `/compact` — Compact the conversation to free context space
- `/clear` — Clear the conversation and start fresh
- `/rewind` — Rewind to a previous checkpoint

Additional slash commands may be available depending on your agent configuration.

## File Attachments

Drag and drop files or images into the prompt editor to attach them. Text files are included as content; images are sent as visual context for the agent.

## While the Agent is Working

While the agent is processing, the prompt editor shows a **Stop** button. Click it (or press **Escape**) to interrupt the agent mid-response.

## Tips

- Be specific about what you want — include file names, function names, or line numbers when possible
- Use `@` file references to point the agent at specific files
- For large tasks, break them into smaller steps and iterate
- If the agent goes in the wrong direction, interrupt it and clarify
