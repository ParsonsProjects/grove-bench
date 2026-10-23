# Project Memory

Open the Memory panel from the brain icon in the sidebar bottom controls. Project memory stores persistent notes about your project that the agent can read and write across threads.

## How It Works

Memory files are markdown documents organized into folders. They are stored per project, so each project has its own set of notes.

When a thread starts, the agent gets:

- **conventions/ in full**, up to 6 KB, newest first. These are the rules it should always follow.
- **An index** of every other file: one line each with its path, title and description. The agent reads a file with `memory_read` when its topic matters to the task.

The index is taken when the thread starts. Notes saved during the thread don't appear in it, but the agent can see them with `memory_list`. Each file's one-line `description` (in its frontmatter) is what the agent sees before it decides to read the file, so keep it accurate.

## Folders

Memory is organized into four folders:

- **repo/** — Overview information about the repository (tech stack, structure, key files)
- **conventions/** — Coding conventions, naming patterns, and style guidelines
- **architecture/** — Data flow, module relationships, and architectural decisions
- **sessions/** — Thread notes: notes about one feature, task, bug or investigation, and plans. They expire (see below), so work-specific detail goes here rather than in architecture/

## Auto-Save

With **Auto-save project memory** on, a background model reads the recent part of a thread after its turns (at most every few minutes) and saves what's worth keeping. It doesn't get every memory file. It gets the full text of the ones that matter, up to 24 KB: files the thread read or wrote, the thread's own note, conventions/, then files whose title or description matches the conversation. The rest are listed in an index. It only rewrites files it was shown in full. For a file it only saw in the index, it can add a short section at the end under a dated heading ("## Added 2026-10-12"), which compaction later merges in.

## Thread Note Expiry

Thread notes are archived when they haven't been updated for 30 days, and at most the 20 newest are kept. This happens after every memory auto-save, when a thread starts and when you compact. A note's age is the later of its `updatedAt` frontmatter and the file's modification time, so a note that was just written is never archived by mistake. Archived notes go to a hidden folder inside the memory directory (`_pruned-sessions`), where they stay until you delete them.

## Compaction

Memory grows as the agent saves notes across threads, and over time it collects duplicates, stale details, and statements that contradict newer discoveries. The **Compact** button (two arrows pointing in, at the bottom of the panel) cleans up the project selected in the panel. It only runs when you press it, and only on that project.

A run works in steps, each one model call:

1. **Planning.** The model reads every file's path, size, title, description and opening text (not the full text). It picks groups of files that overlap, and writes a one-line description for each file that has none. Grove adds those descriptions to the files' frontmatter without changing anything else.
2. **Merging**, up to 6 groups a run, largest overlaps first. Each step reads one group in full (under 48 KB) and merges it: repeated facts appear once, contradictions are resolved (the newer note wins, and your corrections always win), stale details are dropped, and sections auto-save added under "## Added" headings are folded in. Files with such sections are tidied first, even if the plan doesn't pick them. A step may only change its own files, or add new files for merged content, and each file must stay under 16 KB. A step whose files changed on disk while it ran (an auto-save in another thread, say) is skipped rather than overwriting that change.

If more groups are left, the summary says so: press **Compact** again to continue. Each step has its own timeout (**Compaction timeout** in Settings). If a step times out or fails, or you press **Cancel**, the run stops there; steps already finished stay applied and Undo still reverts them.

Before a run changes anything, the previous contents are saved as a timestamped snapshot inside the memory folder (the 5 most recent snapshots are kept). A step whose result would destroy most of its files, or write a file over 16 KB, is rejected and the rest of the run carries on. After a run, a summary lists every file that was rewritten or removed with the reason, and **Undo** restores the snapshot, reverting the whole run in one click. **Backups** (the clock with an arrow, next to Compact) lists all snapshots: use **View** to inspect a snapshot's files before restoring it. Restoring takes a snapshot of the current state first, so the restore itself can be undone.

The Memory panel shows a budget meter (**Agent prompt budget**): how much of the 16 KB memory budget the conventions and the index take in the agent's system prompt, and when the last compaction changed something. If the index outgrows the budget, the meter says how many files were left out of it. The agent can still find those with `memory_list`, but won't know to look, so compact or clean up when you see it.

**Clean up notes** (the broom, next to Backups) lists thread notes older than a chosen cutoff (any number of days) so you can review exactly what will be removed before deleting it. This deletes memory files only — your actual threads in the sidebar are never touched. Notes without a readable date are surfaced at the top as "unknown date" rather than deleted silently. Unlike compaction, thread-note deletion is permanent — thread notes are not included in backups. (To remove old *threads* themselves, use **Clean up old threads** in the sidebar.)

**Auto-save project memory** (on by default) and **Compaction timeout** are in **Settings → Background work (Tending)**.

## Managing Memory

- **Browse** — Select a project and click through folders and files to read their contents
- **Edit** — Click the edit button to modify a memory file's content
- **Create** — Use the + button to add a new memory file
- **Delete** — Remove outdated or incorrect memory files

## Tips

- Memory helps the agent avoid repeating mistakes across threads
- If the agent keeps getting something wrong, add a note to the conventions folder
- Thread summaries help future threads understand context from past work
