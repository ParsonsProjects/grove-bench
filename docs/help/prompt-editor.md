# Prompt Editor

The prompt editor at the bottom of the workspace is where you type instructions for the agent.

## Sending Messages

Type your message and press **Enter** to send. The agent will begin processing immediately.

For multi-line messages, use **Shift+Enter** to add a new line without sending.

## File References

Type `@` followed by a filename to open the file picker. Select a file to reference it in your message — the agent will have that file's content as context.

## Slash Commands

Type `/` to see available commands:

- `/compact` — Compact the thread to free context space
- `/clear` — Clear the thread and start fresh
- `/rewind` — Rewind to a previous checkpoint

Additional slash commands may be available depending on your agent configuration.

## File Attachments

Drag and drop files into the prompt editor, paste an image, or click the paperclip to pick files. How each one reaches the agent depends on its type:

- **Text and code files** up to 100 KB are included in the message.
- **Images** (PNG, JPEG, GIF, WebP) up to 5 MB are sent for the agent to look at.
- **PDFs** of up to 10 pages and 5 MB are sent whole, so the agent sees their text and pictures. A longer PDF is given by path, and the agent reads the pages it needs.
- **Audio** is sent to agents that take it. Claude Code doesn't, so it gets the path.
- **Any other file** up to 25 MB is saved with the thread and the agent gets its path, so it can open the file with its own tools. Text files over 100 KB and images over 5 MB are attached this way too.

Hover a file's chip to see its size. Click × to remove it before sending.

## While the Agent is Working

While the agent is processing, the prompt editor shows a **Stop** button. Click it (or press **Escape**) to interrupt the agent mid-response.

## Tips

- Be specific about what you want — include file names, function names, or line numbers when possible
- Use `@` file references to point the agent at specific files
- For large tasks, break them into smaller steps and iterate
- If the agent goes in the wrong direction, interrupt it and clarify
