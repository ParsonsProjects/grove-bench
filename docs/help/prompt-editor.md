# Prompt Editor

The prompt editor at the bottom of the workspace is where you type instructions for the agent.

## Sending Messages

Type your message and press **Enter** to send. The agent will begin processing immediately.

For multi-line messages, use **Shift+Enter** to add a new line without sending.

## Larger Editor

For a long message, click the expand button beside the paperclip. The same message opens in a larger editor, where **Enter** adds a new line and **Ctrl+Enter** sends it (or adds it to the queue while the agent works). **Done** or **Escape** takes you back to the prompt editor with the text kept. You can paste images and drop files there too.

## Suggested Next Prompt

After a turn, the empty prompt editor may show a grey guess at your next message, such as "Run the tests". Press **Tab** to put it in the box, then **Enter** to send it or edit it first. Start typing to ignore it.

Claude Code makes its own suggestion from the thread's prompt cache, which costs little. Turn it off with **Suggest the next prompt** in **Settings → Background work (Tending)**.

Other agents don't make their own. Tick **Also suggest with other agents** there to ask them once per turn on their background model, which costs a model call each time. They are sent the thread's goal (or your first message, if it has no goal or switched agents), your last three messages and the end of the agent's latest reply: no tool output and no file contents.

There is no suggestion after a thread's first turn, in plan mode, after a turn that failed, or one you stopped. Claude Code also holds back while your plan is near its usage limit.

## File References

Type `@` followed by a filename to open the file picker. Select a file to reference it in your message — the agent will have that file's content as context.

## Slash Commands

Type `/` to see available commands:

- `/compact` — Compact the thread to free context space (agents that can, such as Claude Agent)
- `/clear` — Clear the thread and start fresh
- `/rewind` — Rewind to a previous checkpoint

Additional slash commands may be available depending on your agent configuration.

## File Attachments

Drag and drop files into the prompt editor, paste an image, or click the paperclip to pick files. How each one reaches the agent depends on its type:

- **Text and code files** up to 100 KB are included in the message.
- **Images** (PNG, JPEG, GIF, WebP) up to 5 MB are sent for the agent to look at.
- **PDFs** are saved with the thread and the agent gets the path, then reads the pages it needs. Sending a whole PDF with the message would keep it in every later request, and a few could push the thread past the model's size limits.
- **Audio** clips up to 5 MB in a common format (MP3, WAV, AAC, OGG, FLAC, AIFF, M4A, Opus, WebM) are sent to agents that take audio, up to 10 MB in all per thread since you last switched agent. Other agents, Claude Code included, other formats and anything over those limits get the path.
- **Any other file** up to 25 MB is saved with the thread and the agent gets its path, so it can open the file with its own tools. Text files over 100 KB and images over 5 MB are attached this way too, and so are images sent to an agent that can't take images.

One message's attachments can add up to 50 MB. Hover a file's chip to see its size. Click × to remove it before sending.

You don't have to type anything: attachments on their own, such as a pasted screenshot, send as a message. Slash commands and `!` shell commands can't take attachments, so remove them first or send them in the next message. Rewinding to a message puts its attachments back in the box along with its text.

## While the Agent is Working

While the agent is processing, the prompt editor shows a stop button (the red square). Click it to interrupt the agent mid-response.

You can keep typing while it works. **Enter**, or the send button (a list with a plus while the agent works), adds your message to the queue, and it is sent once the agent is free.

The queue pauses when you stop the agent, rewind, or the agent hits its plan's usage limit, so queued messages don't go out into a turn you interrupted or one that can't run. **Resume** in the queue sends the next one when you're ready.

### The queue

Each queued message shows its first line. Click it to see the whole message, and click again to fold it. On each message:

- **Edit** opens it in the message box. It keeps its place in the queue while you edit: **Enter** saves it there, and **Esc** or **Cancel** leaves it as it was. Whatever you had typed in the box comes back afterwards. The message being edited, and the ones behind it, wait until you're done.
- The **up and down arrows** change the order.
- **×** removes it.
- **Send** (while the agent is idle) sends it now, ahead of the others. A paused queue stays paused for the rest.

With two or more messages queued, **Merge** joins them into one message, in order with a blank line between them, so they go in a single turn. Commands can't be merged. **Clear queue** removes them all.

Remove, Clear queue and Merge can be undone for 5 seconds from the note that appears.

The queue is saved, so a restart doesn't lose it. A queue that comes back after a restart starts paused: **Resume** sends it.

### Steering (alpha, Claude only)

Steering gives a message to the agent in the turn it is running now, instead of waiting for the turn to end. The agent reads it once its current tool call finishes. Press **Alt+Enter** to steer, or hold **Alt** and click the send button (it shows an arrow turning right). **Send now** on a queued message steers that one.

A steered message waits 5 seconds before it goes, with a pulsing square and **Take back**, which puts it back in the message box. After that it shows **Sent · not read yet** until the agent reads it, and then it appears in the thread where the agent read it, marked **steer**. A steer has no checkpoint of its own, so there is no rewinding to it.

- If the turn ends before a steer goes, it is sent as the next message instead.
- If you stop the agent before it reads a steer, the steer goes back to the top of the paused queue, marked **not read**. Stopping then restarts the agent, which takes a moment longer than a normal stop.
- Only text can be steered: a message with images or other files, and commands, wait in the queue.
- Only Claude can be steered so far. For other agents, Enter and Alt+Enter both queue.

To make Enter steer and Alt+Enter queue, change **While the agent works, Enter** in Settings > The grove.

## Tips

- Be specific about what you want — include file names, function names, or line numbers when possible
- Use `@` file references to point the agent at specific files
- For large tasks, break them into smaller steps and iterate
- If the agent goes in the wrong direction, interrupt it and clarify
