# Terminal Tab

The Terminal tab (`Alt+4`) provides a full terminal emulator connected to your conversation's worktree directory.

## Overview

Each conversation has its own dedicated terminal (PTY). The terminal opens in the worktree directory for that conversation, so you can run commands directly in the same environment the agent is working in.

Closing a conversation or deleting it closes its terminal and ends everything started from it, such as a dev server, so the ports it was using are freed. Background commands the agent started are ended too. When you open the conversation again, it gets a fresh terminal.

## Features

- **Full terminal emulation** — Supports colors, cursor movement, and interactive programs
- **10,000 line scrollback** — Scroll up to see previous command output
- **Clickable links** — URLs in terminal output are clickable
- **Copy/paste** — Standard clipboard shortcuts work in the terminal

## Common Uses

- Run your application to test agent changes
- Execute git commands (commit, push, merge)
- Install dependencies
- Run tests or build scripts
- Debug issues the agent encountered
