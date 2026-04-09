# Project Memory

Open the Memory panel from the brain icon in the sidebar bottom controls. Project memory stores persistent notes about your project that the agent can read and write across sessions.

## How It Works

Memory files are markdown documents organized into folders. They are stored per-repository, so each project has its own set of notes.

The agent automatically reads relevant memory files at the start of each session and can create or update them as it learns about your project.

## Folders

Memory is organized into four folders:

- **repo/** — Overview information about the repository (tech stack, structure, key files)
- **conventions/** — Coding conventions, naming patterns, and style guidelines
- **architecture/** — Data flow, module relationships, and architectural decisions
- **sessions/** — Notes from past sessions, summaries of work done

## Managing Memory

- **Browse** — Select a repo and click through folders and files to read their contents
- **Edit** — Click the edit button to modify a memory file's content
- **Create** — Use the + button to add a new memory file
- **Delete** — Remove outdated or incorrect memory files

## Tips

- Memory helps the agent avoid repeating mistakes across sessions
- If the agent keeps getting something wrong, add a note to the conventions folder
- Session summaries help future sessions understand context from past work
