# Linked Projects: One Thread Working in a Second Project

> **Status: Proposal.** Nothing is built yet. This is a smaller slice of Goal 2
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
- Grove shows B's branch, uncommitted changes, ahead/behind and PR status.
  Read-only: Grove doesn't commit, push or open PRs in B.
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
- **Direct threads** (running in A's project folder) link B on A's current
  branch name.
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

## Keeping B's edits in the worktree

`additionalDirectories` gives the agent access. It doesn't stop the agent
writing elsewhere. So this is best effort:

- **Claude Code.** Grove already has a PreToolUse hook (`limitHook`,
  `src/main/adapters/claude-code.ts`), which "fires on every tool call, ahead
  of the permission flow". It gains a check: Edit, Write and NotebookEdit
  calls whose path is inside B's project folder are denied, and the reason
  names the worktree path to use instead. Shell commands can't be checked
  reliably (`cd`, scripts), so a write made from the shell can still land in
  B's project folder.
- **ACP agents.** Grove only sees the tool calls an agent asks permission
  for. The same check runs on those. In an agent's own auto modes nothing is
  checked.
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

## Not in the first version

Each of these says so in the UI where it matters:

- **Rewind.** Checkpoints are git commits in one repository
  (`src/main/checkpoints.ts`). Rewinding resets A only. The rewind dialog
  says B's changes stay.
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
| 1 | Link data, linking at start, branch rules including rename, prompt text, the edit check, Read-safe, delete and sweep, status bar item | Link B when starting a thread and see its state |
| 2 | Link and unlink part way through (restart and resume) | Link B later in a thread |
| 3 | Optional: a read-only Changes view for B, checkpoints in B | Review B's diff, rewind both |

## Tests

- `worktree-manager`: making a link, renaming across both repositories with
  rollback, removing with and without the branch, the sweep keeping a link's
  folder and dropping an orphaned link.
- `ipc`: `SESSION_CREATE` with `linkedRepos`, and a branch held in B being
  refused.
- `claude-code` adapter: `additionalDirectories` passed; the hook denying an
  edit in B's project folder.
- `acp-adapter`: the list sent only when advertised, on new, resume and load
  (the fake agent fixture gains the capability).
- `session-config`: the prompt text with links.
- Renderer: the draft control, the status bar item, the delete dialog naming
  a dirty link.

## To check before building

- Does PreToolUse run in `bypassPermissions` mode? The hook's comment says it
  runs on every tool call, but this mode needs a test.
- Does a resumed Claude Code session use a changed `appendSystemPrompt` and
  `additionalDirectories`? Expected yes, since both are read at launch, but
  it needs a test.
- Which ACP agents advertise the capability? A web search summary of
  OpenCode's docs says it accepts `additionalDirectories` on new, load,
  resume and fork ([OpenCode ACP docs](https://opencode.ai/docs/cli/acp/)),
  but the page couldn't be opened from where this plan was written, so that is
  unconfirmed. Gemini CLI and Copilot CLI are unknown. Checking each agent's
  `initialize` answer settles it.
- B's CLAUDE.md. The bundled CLI reads a
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` variable. By its name, extra
  folders don't load their CLAUDE.md unless it is set. How it behaves needs
  confirming before Grove sets it.

## Open questions

1. Should B's uncommitted changes be a count in the status bar only, or also
   a read-only file list with diffs in the Changes tab? `ReviewDiffPanel`
   takes its data as callbacks and hides staging when none is passed, so a
   read-only view is cheap. It would need diff IPC keyed by link.
2. Is rewinding A only, with a warning, enough for the first version?
3. ACP agents that don't advertise the capability: allow linking with a
   warning (the path is in the prompt, but the agent may refuse to edit it),
   or refuse?
4. Should Grove load B's CLAUDE.md for the agent?

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
- [OpenCode ACP docs](https://opencode.ai/docs/cli/acp/) (not opened, see
  above)
- [git-worktree](https://git-scm.com/docs/git-worktree): `git worktree add`
  refuses a branch that another worktree has checked out, unless forced
