# Linked Projects: One Thread Working in a Second Project

> **Status: Phases 0, 1 and 2 built; 3 not started.** The open
> questions are settled (see "Decisions"). Where the build differs from
> this plan, "What was built" says so. This is a smaller slice of Goal 2
> in `docs/projects-plan.md` ("one conversation, several repositories"). It
> adds linked checkouts next to a thread's own checkout and leaves the
> existing single-checkout fields alone.

## The problem

A thread starts in project A. Part way through, the agent also edits project
B. Grove doesn't know about B, so:

- B's edits land in B's own project folder, on whatever branch is checked out
  there, not in a worktree.
- Grove shows nothing about B: no branch, no changes, no ahead/behind, no PR.

## What was agreed

- B can be linked when the thread starts, or part way through.
- B gets its own git worktree, made by Grove, on the same branch name as the
  thread.
- Grove shows B's branch, uncommitted changes, ahead/behind and PR status,
  and B's changed files with their diffs in the Changes tab. Read-only: Grove
  doesn't stage, commit, push or open PRs in B.
- Deleting the thread deletes B's worktree too, with the same checks as the
  thread's own worktree.
- Every agent: Claude Code and the ACP agents.

## Why not Groups

Groups (`src/renderer/stores/groups.svelte.ts`) hold one thread per project.
Each thread is its own agent with its own `cwd`, and the threads share no
context. Here one agent works in both projects, so Groups don't fit.

## What the agents can take

### Claude Code

- The SDK takes `additionalDirectories?: string[]` ("Additional directories
  Claude can access beyond the current working directory. Paths should be
  absolute.", `sdk.d.ts` line 1467 in `@anthropic-ai/claude-agent-sdk`
  0.3.281).
- The `Query` interface has no public method to add a directory to a running
  session. The internal `register_repo_root` control request only accepts a
  "strict subdirectory of cwd, or of a directory passed at launch"
  (`sdk.d.ts` line 4685), and B's worktree is neither.
- So linking part way through restarts the agent: `stopQuery(id,
  beforeRestart)` in `src/main/agent-session.ts` closes the query and calls
  `runQuery` again on the same session, keeping `providerSessionId`, so the
  agent resumes. Rewind and agent switching already restart this way.

### ACP agents

From the v1 schema in `@agentclientprotocol/sdk` 2.8.0
(`dist/v1/schema/types.gen.d.ts`):

- `session/new`, `session/load` and `session/resume` take
  `additionalDirectories?: string[]`. "Each path must be absolute." `cwd`
  "remains the base for relative paths".
- The agent advertises support with
  `agentCapabilities.sessionCapabilities.additionalDirectories` in its
  `initialize` answer. "Omitted or `null` both mean the agent does not
  advertise support." Grove sends the list only when it is advertised.
- On `session/load` and `session/resume`, a non-empty list "is the complete
  resulting additional-root list for the loaded session. It may differ from
  any previously used or reported list as long as the request `cwd` matches
  the session's `cwd`." So linking part way through is the same restart, with
  the new list on resume or load.
- An agent with neither resume nor load starts a new session on restart
  (`openSession` in `src/main/adapters/acp/acp-adapter.ts`). Linking part
  way through is refused for those agents, because the agent would forget the
  thread.
- Grove's instructions reach an ACP agent only with a new session
  (`pendingInstructions` is set only after `session/new`). A link made part
  way through is told to the agent in a note at the top of the next message.

An agent that doesn't advertise the capability can still be linked. The path
goes in the prompt but not in `session/new`, so the agent may refuse to edit
it. The draft and the link picker say so: "<agent> didn't say it can use
folders outside the project. It's told where B is, but it may not be able to
edit it."

Grove's own `AcpInitializeResult` type (`src/main/adapters/acp/protocol.ts`)
needs the `additionalDirectories` capability added.

## Data

`ManifestEntry` (`src/main/worktree-manager.ts`) gains:

```ts
interface LinkedCheckout {
  repoPath: string;        // B's project folder
  path: string;            // B's worktree: <root>/<hash of B>/<thread id>
  branch: string;          // the branch it was linked on
  createdBranch: boolean;  // Grove made it, so "Also delete the branch" may delete it
  linkedAt: number;
  pendingRemoval?: boolean; // a failed delete, retried at the next sweep
  removingPath?: string;
}

linked?: LinkedCheckout[];
```

- B's worktree folder is named after the thread id. The sweep's
  unknown-folder pass (`sweepStaleWorktrees`) keeps a folder whose name is a
  manifest key, so the link's folder is safe there with no change.
- `WorktreeInfo` (`src/shared/types.ts`) and the renderer's `SessionEntry`
  (`src/renderer/stores/sessions.svelte.ts`) gain `linked`.
  `lib/restore-worktrees.ts` fills it.
- A thread links each project at most once. B must be a git project already
  added in Grove, and not A itself.
- `AdapterConfig` (`src/main/adapters/types.ts`) gains
  `additionalDirectories: string[]`: every link's `path`, plus the
  "Additional working directories" setting (see phase 0).

## Linking

### Branch

- **Same name.** If B already has the branch and no checkout holds it, the
  worktree checks it out. If a checkout holds it (B's project folder or
  another thread), linking is refused, naming where it is checked out. This
  is the rule `continueBranch` uses now (`startNewSession` in
  `src/main/ipc.ts`).
- **New branch.** If B doesn't have it, it is made from B's default base
  branch, with `pullBaseBranch` as now.
- **Placeholder names.** A new thread starts on `grove/<id>`
  (`src/shared/temp-branch.ts`) and is renamed after the first reply
  (`BRANCH_AUTO_NAME`). A link made at start also starts on the placeholder.
  `renameBranch` then renames every checkout: it first checks that the new name
  is free and not pushed in each repository, then renames them one by one,
  and renames any already done back if a later one fails. A manual rename
  (`BRANCH_RENAME`) works the same way.
- **After that, B keeps its own branch.** If the thread switches branch, or
  the agent checks out another branch in B, B's branch isn't moved to
  follow. The status shows whatever B has checked out.
- **Direct threads** (running in A's project folder) can't link yet. Main
  refuses it and the draft doesn't offer it with Project folder: a direct
  thread is set up without the background step that makes worktrees and
  installs their dependencies.
- **Threads without git** (folder projects) can't link: there's no branch
  name. The menu says why.

### When the thread starts

- The draft's options (`DraftOptions.svelte`) get an "Also work in" control
  that lists the git projects other than A. It shows the branch B will get,
  and any conflict (the branch is checked out somewhere).
- `CreateSessionOpts` gains `linkedRepos?: string[]`. `startNewSession`
  makes B's worktree after A's, through the same `create()` path, so
  untracked files are copied and dependencies installed as for A. Both run
  under `trackPendingSetup`, so deleting the thread during setup stops both.

### Part way through

- "Link a project…" in the thread row's menu (`getContextMenuItems`,
  `Sidebar.svelte`) and in the status bar branch popup
  (`StatusBarBranch.svelte`).
- Allowed only while the agent is idle. During a turn it waits for the turn
  to end.
- Steps: make B's worktree, restart with `stopQuery(id, beforeRestart)` with
  the new list, add the note to the next message.

### Unlinking

- "Unlink" in B's status bar popup. It runs the same checks as delete
  (uncommitted changes, unmerged commits), removes B's worktree, and restarts
  the agent without it.

## What the agent is told

`appendedSystemPrompt` (`src/main/session-config.ts`) tells the agent to use
relative paths and "NEVER use absolute paths". With a linked project that
would steer the agent away from B, so it becomes:

- Relative paths for A, as now.
- For each linked project: its name, the worktree's absolute path and its
  branch. Use absolute paths inside it.
- Never edit B's project folder (its path is given), only the worktree.
- Run git for B with `git -C <worktree path>`.

B's own instructions:

- **Claude Code.** "By default, CLAUDE.md files from these directories are
  not loaded." Setting `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` loads
  the extra folder's `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and
  `.claude/rules/*.md` (except rules with a `paths` field)
  ([memory docs](https://code.claude.com/docs/en/memory#load-from-additional-directories)).
  Grove sets it in `extraEnv` for threads with links. An `AGENTS.md` in B
  doesn't load this way, per the same page, so the prompt names it when B has
  one and no `CLAUDE.md`.
- **ACP agents.** How an agent reads instructions from an extra folder is up
  to the agent, so the prompt names B's `CLAUDE.md` or `AGENTS.md` when there
  is one.

## Keeping B's edits in the worktree

`additionalDirectories` gives the agent access. It doesn't stop the agent
writing elsewhere. So this is best effort:

- **Claude Code.** Grove adds deny rules for B's project folder to the
  settings it already passes to the SDK (`flagSettings` in
  `src/main/adapters/claude-code.ts`, the SDK's `settings` option, which
  takes `permissions`). "Deny rules block in every mode, including
  `bypassPermissions`"
  ([permission modes docs](https://code.claude.com/docs/en/permission-modes)),
  and "`Edit` rules apply to all built-in tools that edit files"
  ([permissions docs](https://code.claude.com/docs/en/permissions)). So one
  rule, `Edit(//<B's project folder>/**)`, covers Edit, Write and
  NotebookEdit. Windows paths are matched in POSIX form, so `C:\code\b`
  becomes `//c/code/b/**` (same page). The rule is left out if B's worktree is
  inside B's project folder (a custom worktree folder there), or it would
  block the worktree too. Shell commands aren't covered: a write made from
  the shell can still land in B's project folder.
  - Later: `permissions.blockWritesOutsideWorkingDirectories` refuses edits
    outside the working directories in every mode, but needs Claude Code
    2.1.314. The SDK in use (0.3.281) runs 2.1.281 (`claudeCodeVersion` in
    its `package.json`).
- **ACP agents.** Grove only sees the tool calls an agent asks permission
  for. For those, Grove's own policy check (`tool-policy.ts`) refuses an edit
  whose path is inside B's project folder. In an agent's own auto modes
  nothing is checked.
- **Read-safe mode.** `readSafeSandbox` lists every checkout in `allowWrite`,
  and the read-only classifier (`session-permissions.ts`,
  `read-only-tools.ts`) counts linked worktrees as inside the project.

## Showing B's state

- **Main.** One new IPC, `git:linkedStatus(sessionId)`, run through
  `inBackground` like the other polled git calls. For each link it returns:
  the project, the branch checked out now, the uncommitted file count,
  `syncStatus` (upstream, ahead, behind; `src/main/git.ts`) and the PR for
  that branch (`prsForBranches(B's repoPath, ...)`, `src/main/gh.ts`).
- **Renderer.** A `linkedStore`, refreshed on the same schedule as `prStore`
  (every 60 s, every 5 min when idle, at the end of a turn, on window focus).
- **Status bar.** One compact item per linked project next to
  `StatusBarBranch`: the project name, the branch, ±N changes, ↑N ↓N and the
  PR badge. Clicking it opens a popup with the same rows as `StatusBarSteps`,
  plus Open folder and Unlink.
- **Sidebar.** A thread row with links gets a small link icon. Its tooltip
  names the linked projects.
- **Changes tab.** A project switcher in the panel header, shown only when the
  thread has links. Picking B shows B's changed files and diffs read-only.
  `ChangesReviewPanel` passes `ReviewDiffPanel` its data as callbacks, and
  `ReviewDiffPanel` hides staging when no `onStage` is passed, so B's view
  passes none. `GIT_STATUS`, `FILE_DIFF` and `FILE_LINES` take an optional
  linked project (`repoPath`) and resolve to that link's worktree instead of
  the thread's. Branch scope compares against B's PR base, else B's default
  branch, the same order the store uses for A. `gitStatusStore` keys its
  state by thread and project so A's and B's views don't mix. Viewed marks
  and review comments (`reviewStore`) are keyed the same way.

## Delete and cleanup

- **Checks before delete** (`requestDestroy`, `Sidebar.svelte`):
  uncommitted changes and unmerged commits are checked for each link too. The
  dialog names the project that has them.
- **`SESSION_DESTROY`** removes each link's worktree through the same
  `remove()` path: move it aside, prune B, delete the files in the worker.
  "Also delete the branch" deletes B's branch only when Grove made it
  (`createdBranch`), under the same rules as `deleteConversationBranches`.
- **Bulk cleanup and removing a project** run the same checks for each link.
  Removing project B while a thread in A links it is refused, naming the
  thread. Today `REPO_REMOVE` only checks threads whose own project is B.
- **Startup sweep.** `cleanupOrphans(B)` only looks at entries whose
  `repoPath` is B, so links need their own pass. A link whose folder is gone,
  or that B's git no longer lists, is dropped. When A's entry is dropped as an
  orphan, its links are removed too and B is pruned. A link with
  `pendingRemoval` is retried, as threads are.

## Not covered

Each of these says so in the UI where it matters:

- **Rewind** resets A only (decided). Checkpoints are git commits in one
  repository (`src/main/checkpoints.ts`). The rewind dialog says B's changes
  stay.
- **Files made** watches A only (`src/main/turn-files.ts`).
- **Terminal** opens in A.
- **Commit, push, Create PR and commit messages** work in A only. In B the
  agent or the user commits.
- **Preview** opens `file://` pages from A only.
- **Memory and skills** stay A's.

## Phase 0: the "Additional working directories" setting

The help page says these are "Folders outside the project that agents can
also use" (`docs/help/settings.md`), but nothing in `src/main` passes
`workingDirectories` to the agent. Phase 0 adds `additionalDirectories` to
`AdapterConfig`, passes it from both adapters (ACP only when advertised) and
fills it from the setting. It is useful by itself and is the base for links.

## Phases

| Phase | Scope | What the user gets |
|---|---|---|
| 0 | `additionalDirectories` in `AdapterConfig`, both adapters, the setting wired | "Additional working directories" works |
| 1 | Link data, linking at start, branch rules including rename, prompt text and B's CLAUDE.md, the deny rule, Read-safe, delete and sweep, status bar item | Link B when starting a thread and see its state |
| 2 | Read-only Changes view for B | See B's changed files and diffs |
| 3 | Link and unlink part way through (restart and resume) | Link B later in a thread |

## Tests

- `worktree-manager`: making a link, renaming across both repositories with
  rollback, removing with and without the branch, the sweep keeping a link's
  folder and dropping an orphaned link.
- `ipc`: `SESSION_CREATE` with `linkedRepos`, and a branch held in B being
  refused.
- `claude-code` adapter: `additionalDirectories` passed; the deny rule for
  B's project folder in the settings, in POSIX form for Windows paths, and left
  out when B's worktree is inside that folder.
- `acp-adapter`: the list sent only when advertised, on new, resume and load
  (the fake agent fixture gains the capability).
- `session-config`: the prompt text with links.
- `ipc`: `GIT_STATUS`, `FILE_DIFF` and `FILE_LINES` with a linked project,
  and refusing a project the thread doesn't link.
- Renderer: the draft control and its ACP warning, the status bar item, the
  Changes switcher with no staging in B's view, the delete dialog naming a
  dirty link.

## Still to check

- Does a deny rule in flag settings stop an edit in `bypassPermissions` mode,
  as the docs say? One test with a real agent settles it.
- Does a resumed Claude Code session use a changed `appendSystemPrompt` and
  `additionalDirectories`? Expected yes, since both are read at launch, but
  it needs a test.
- Which ACP agents advertise the capability? A web search summary of
  OpenCode's docs says it accepts `additionalDirectories` on new, load,
  resume and fork ([OpenCode ACP docs](https://opencode.ai/docs/cli/acp/)),
  but the page couldn't be opened from where this plan was written, so that is
  unconfirmed. Gemini CLI and Copilot CLI are unknown. Checking each agent's
  `initialize` answer settles it.

## What was built

Phases 0, 1 and 2, with these differences from the plan above:

- **Direct threads can't link** (see "Branch").
- **The edit check** is a deny rule in Claude Code's settings
  (`editDenyRule`, `src/main/adapters/claude-code.ts`) plus Grove's policy
  (`protectedEditRoots` in `tool-policy.ts`), not a PreToolUse hook.
- **A link that fails at setup** is left out with an error in the thread;
  the thread still starts. Its row keeps the project in `linkedRepos` until
  the app restarts, while the status bar shows only links that exist.
- **The sidebar badge** counts the linked projects, with their names in its
  tooltip.
- **Changes view (phase 2)** is its own component, `LinkedChangesPanel`,
  rather than a second key in `gitStatusStore`: the thread's own view and
  its refresh triggers are left as they were. It reads on show, every 5 s
  while the agent works, at the end of a turn and on focus. `readCheckout`
  in `ipc.ts` resolves `linkedRepo` for `GIT_STATUS`, `FILE_DIFF`,
  `FILE_LINES`, `FILE_CONTENT_DATA_URL` and `FILE_OPEN_IN_EDITOR`; the
  write handlers don't take it. A stopped git operation in a linked
  worktree isn't reported. `ReviewDiffPanel` takes `reviewKey` (viewed
  marks and comments, `linkedReviewKey`) and `linkedRepo` (opens files
  there; no Markdown preview and no last-turn edit marks for those files).
- **Code:** `createLink`, `removeLinks`, `cleanupOrphanLinks` and the
  linked rename in `worktree-manager.ts`; `planLinks` and
  `GIT_LINKED_STATUS` in `ipc.ts`; `linked-projects.ts` (folders, deny
  roots, instruction files); `linkedProjectsPrompt` in `session-config.ts`;
  `StatusBarLinked` and `StatusBarLinkedItem` in the renderer, with
  `linkedStore`.

## Decisions

1. **B's changes:** the status bar shows the count, and the Changes tab shows
   B's file list and diffs, read-only (phase 2).
2. **Rewind:** resets A only, with a warning in the rewind dialog.
3. **ACP agents without the capability:** linking is allowed, with a
   warning.
4. **B's CLAUDE.md:** loaded for Claude Code threads; named in the prompt for
   ACP agents.

## Sources

- Claude Agent SDK typings, `@anthropic-ai/claude-agent-sdk` 0.3.281,
  `sdk.d.ts` (npm), and the
  [TypeScript SDK reference](https://docs.claude.com/en/api/agent-sdk/typescript)
- ACP schema, `@agentclientprotocol/sdk` 2.8.0,
  `dist/v1/schema/types.gen.d.ts` (npm). The quotes above come from it. The
  [session setup docs](https://agentclientprotocol.com/protocol/v1/session-setup)
  and [additional directories RFD](https://agentclientprotocol.com/rfds/additional-directories)
  cover the same feature but couldn't be opened from where this plan was
  written.
- [Claude Code memory docs](https://code.claude.com/docs/en/memory#load-from-additional-directories):
  loading CLAUDE.md from extra folders
- [Claude Code permissions](https://code.claude.com/docs/en/permissions) and
  [permission modes](https://code.claude.com/docs/en/permission-modes): deny
  rules in every mode, `Edit` rule scope, Windows path form
- [OpenCode ACP docs](https://opencode.ai/docs/cli/acp/) (not opened, see
  above)
- [git-worktree](https://git-scm.com/docs/git-worktree): `git worktree add`
  refuses a branch that another worktree has checked out, unless forced
