# Terminal Tab

The Terminal tab (`Alt+4`) provides a full terminal emulator connected to your session's worktree directory.

## Overview

Each agent session has its own dedicated terminal (PTY). The terminal opens in the worktree directory for that session, so you can run commands directly in the same environment the agent is working in.

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
