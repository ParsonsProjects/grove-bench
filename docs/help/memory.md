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

## Auto-Compaction

Memory grows as the agent saves notes across sessions, and over time it accumulates duplicates, stale details, and statements that contradict newer discoveries. Grove Bench compacts memory automatically:

- **Session pruning** — only the 20 most recent session notes are kept; older ones are deleted.
- **Dedupe & merge** — when memory grows past its budget, an AI pass merges files covering the same topic and removes repeated facts.
- **Contradiction resolution** — when two notes conflict, the more recently updated one wins; explicit user corrections always take priority over inferred facts.

Before a compaction pass rewrites anything, the previous contents are saved as a timestamped snapshot inside the memory folder (the 5 most recent snapshots are kept), and a result that would destroy most of the stored knowledge is rejected outright. Compaction runs at most once every few hours, only when memory has actually outgrown the space injected into the agent's system prompt.

The Memory panel shows a **budget meter** — how much of the agent's system-prompt budget your notes consume, when the last compaction ran (and whether it was automatic), and which files no longer fit in the prompt.

You can also compact on demand with the **Compact** button. After a pass, a summary lists every file that was rewritten or removed with the reason, and **Undo** restores the pre-compaction snapshot in one click. **Backups** lists all snapshots — use **View** to inspect a snapshot's files before restoring it; restoring takes a snapshot of the current state first so the restore itself can be undone.

**Clean up notes** lists session notes older than a chosen cutoff (any number of days) so you can review exactly what will be removed before deleting it. This deletes memory files only — your actual sessions in the sidebar are never touched. Notes without a readable date are surfaced at the top as "unknown date" rather than deleted silently. Unlike compaction, session-note deletion is permanent — session notes are not included in backups. (To remove old *sessions* themselves, use **Clean up old sessions** in the sidebar.)

Auto-compaction can be disabled with the `memoryAutoCompact` setting.

## Managing Memory

- **Browse** — Select a repo and click through folders and files to read their contents
- **Edit** — Click the edit button to modify a memory file's content
- **Create** — Use the + button to add a new memory file
- **Delete** — Remove outdated or incorrect memory files

## Tips

- Memory helps the agent avoid repeating mistakes across sessions
- If the agent keeps getting something wrong, add a note to the conventions folder
- Session summaries help future sessions understand context from past work
