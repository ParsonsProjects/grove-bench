# Projects, Workspaces and Scratch Conversations

> **Status: Phase 1 implemented, phases 2 and 3 are proposals.** The UI, help
> and docs say "conversation" and "project"; the code still says "session" and
> "repo" on purpose (see `CLAUDE.md`, Terminology).
>
> Phase 1 shipped `Project` and `ProjectWorkspace` in `src/shared/types.ts`,
> `src/main/projects.ts` (projects.json, adoption of manifest paths, rename,
> remove) and the `project:*` IPC channels. Two items the table below listed
> under phase 1 were deliberately left for phase 3, where they first pay off:
> stamping manifest entries with `projectId`/`workspaceId`, and re-keying
> memory, colors and skill caches by project id. With exactly one workspace per
> project the workspace path already identifies the project, and moving the
> memory directories is a migration with real failure modes and no benefit
> until a project can span more than one path.

## Goals

1. A project does not have to be a git repository.
2. One conversation can edit several repositories at once.
3. A conversation can start with no project at all, in a scratch folder under
   the app's data directory.

## Where we are today

Everything below is what the code does now, so the plan can be checked against it.

- **A project has an identity of its own (phase 1).** `src/main/projects.ts`
  persists projects in `projects.json` under `userData`. Before that the list
  was derived from the worktree manifest (`listRepos()` in
  `src/main/worktree-manager.ts`), so a repository with no conversations
  vanished on restart. `listRepos()` still exists: the `project:list` handler
  adopts any manifest path without a project, which is both the one-off
  migration and a standing safety net.
- **Adding a project requires git.** `validateRepo()` is `isGitRepo()`
  (`src/main/worktree-manager.ts`), and the folder picker in `src/main/ipc.ts`
  rejects anything else.
- **A conversation has exactly one checkout.** `SessionInfo` and
  `CreateSessionOpts` in `src/shared/types.ts` carry a single `repoPath`,
  `branch` and `worktreePath`. The adapter gets one `cwd`.
- **Direct mode already means "no worktree".** `registerDirect()` in
  `src/main/worktree-manager.ts` records a conversation that runs in place on an
  existing checkout. This is the seed for folder workspaces.
- **Everything keyed by repo path.** Memory lives at
  `<userData>/memory/<sanitised repoPath>` (`src/main/memory.ts`). App state
  keys `collapsedRepos`, `knownSkills` and `skillSuggestions` by repo path
  (`src/main/app-state.ts`), and settings key `repoColors` the same way.
- **Extra directories are stored but never used.** `workingDirectories` exists in
  `src/main/settings.ts` and has a Settings UI, but nothing in `src/main`
  passes it to the adapter.
- **Read-safe mode sandboxes writes to one folder.** `readSafeSandbox()` in
  `src/main/agent-session.ts` sets `allowWrite: [worktreePath]`.
- **The SDK can take extra directories.** `@anthropic-ai/claude-agent-sdk`
  0.3.223 exposes `additionalDirectories?: string[]` on its options
  ("Additional directories Claude can access beyond the current working
  directory. Paths should be absolute.", `sdk.d.ts` line 1332). It is the SDK
  form of the CLI's `--add-dir` flag. See the
  [TypeScript SDK reference](https://docs.claude.com/en/api/agent-sdk/typescript).

## Data model

Three entities replace "repo path" as the unit the app reasons about.

```ts
interface Project {
  id: string;                 // short random id, stable across renames and moves
  name: string;               // user-editable; defaults to the first workspace's folder name
  kind: 'normal' | 'scratch'; // scratch projects live under userData and are hidden from the sidebar
  color?: string;             // replaces settings.repoColors
  workspaces: Workspace[];    // at least one; order matters (first is primary by default)
  createdAt: number;
}

interface Workspace {
  id: string;
  path: string;               // absolute path to the checkout or folder
  kind: 'git' | 'folder';     // decided at add time, re-checked on launch
  defaultBranch?: string;     // git only; overrides settings.defaultBaseBranch
}

/** What a conversation holds per workspace. */
interface Checkout {
  workspaceId: string;
  path: string;               // worktree path, or the workspace path in direct mode
  branch?: string;            // git only
  direct: boolean;
}
```

A conversation then carries `projectId`, `primaryWorkspaceId` and
`checkouts: Checkout[]`. `SessionInfo.repoPath`, `branch` and `worktreePath`
stay for one release as derived views of the primary checkout so the renderer
can move over gradually.

Projects are stored in `projects.json` under `userData`. Writes are not
debounced: project changes are rare and user-initiated, and the record must be
on disk before the IPC call returns. The worktree manifest keeps its job
(per-checkout bookkeeping); in phase 3 each entry gains `projectId` and
`workspaceId`.

### Migration

Step 1 is done (phase 1). Steps 2 to 4 belong to phase 3:

1. For each distinct `repoPath` in the manifest, create a `normal` project with
   one `git` workspace at that path. Name it from the folder name.
2. Stamp every manifest entry with the new `projectId` and `workspaceId`.
3. Move `<userData>/memory/<sanitised repoPath>` to
   `<userData>/memory/<projectId>` and write the old key into the project's
   `index.json` so a failed move can be retried.
4. Re-key `collapsedRepos`, `knownSkills`, `skillSuggestions` and `repoColors`
   by project id. Keep the old keys until the next schema bump, then drop them.

The manifest already has a precedent for this kind of migration
(`claudeSessionId` to `providerSessionId`).

## Goal 1: projects without git

- **Adding.** The folder picker accepts any folder. If `isGitRepo()` is true
  the workspace is `git`, otherwise `folder`. The dialog title becomes "Select a
  project folder".
- **Starting a conversation.** A `folder` workspace has no branch mode. The
  conversation always runs direct on the folder. `NewAgentDialog` hides the
  Branch Mode, Branch Name and Base Branch fields when every workspace in the
  chosen project is a folder.
- **What the UI hides.** Changes, Checkpoints (branch and turn diffs), Git ops,
  Create PR, sync status and the PR watcher all need git. For a folder
  workspace each shows one line: "This workspace is not a git repository." The
  Terminal, Activity, Memory and Skills panels work as they do now.
- **What still works without git.** Rewind is driven by the SDK's file
  checkpoints, not by git, so it keeps working. Dependency install, memory,
  skills and MCP config all key off the folder.
- **Orphan sweep.** `cleanupOrphans()` runs `git worktree` commands per
  repository. It skips `folder` workspaces.

## Goal 2: one conversation, several repositories

The hard constraint is that Claude Code has one working directory. Project-level
CLAUDE.md files, `.claude/settings.json`, project skills and `.mcp.json` are
resolved from `cwd`
([memory docs](https://docs.claude.com/en/docs/claude-code/memory),
[settings docs](https://docs.claude.com/en/docs/claude-code/settings)).
So one workspace is primary and the rest are additional.

- **Launch.** `cwd` is the primary checkout's path. Every other checkout's path
  goes into `additionalDirectories`, together with the user's global
  `workingDirectories` setting, which finally gets used.
- **Checkouts.** For each `git` workspace the conversation gets its own worktree
  on the same branch name, created by the existing `create()` path. Git allows a
  branch to be checked out in only one worktree per repository
  ([git-worktree](https://git-scm.com/docs/git-worktree)), which is fine here
  because each repository is separate. `folder` workspaces are always direct.
- **Read-safe mode.** `readSafeSandbox()` takes every checkout path, not just
  one, or the agent cannot edit the second repository.
- **Path rules in the system prompt.** `agent-session.ts` tells the agent to use
  relative paths from "the project root". With several roots this becomes: use
  paths relative to the primary root, and absolute paths only inside the other
  listed roots. Each root is listed by name.
- **Changes, Checkpoints, Git ops, PR.** Each of these is per checkout today
  (`GIT_STATUS` and friends in `src/main/ipc.ts` resolve a session to one
  `worktreePath`). They gain a `workspaceId` parameter and the panels get a
  workspace switcher in their header, shown only when a conversation has more
  than one checkout. The status bar's branch and PR badge follow the selected
  workspace.
- **Destroy and clean up.** Destroying a conversation removes every checkout.
  The "also delete the branch" option applies to every git workspace. The
  clean-up dialog's uncommitted-changes check runs per checkout and flags the
  conversation if any checkout is dirty.
- **Commit message and PR prompts.** `commit-message.ts` and `pr-prompt.ts`
  read one repository. They take the selected workspace.
- **Sidebar.** A project row shows all its conversations. Grouping by branch
  uses the primary checkout's branch.

Start with a limit of one primary plus any number of additional workspaces,
where only the primary can be created in a fresh worktree from the dialog and
additional git workspaces default to direct on their current branch. That keeps
the first version small. Worktrees for every workspace can follow.

## Goal 3: scratch conversations

- A "New conversation" action with no project creates a `scratch` project on
  the fly: one `folder` workspace at `<userData>/scratch/<projectId>`.
- Scratch projects are hidden from the Projects tree. Their conversations show
  only in the Conversations list, prefixed "Scratch".
- Memory is keyed by project id like any other, so a scratch conversation still
  gets notes, but the memory panel lists scratch projects under a separate
  heading.
- **Promotion.** The context menu offers "Move to project", which re-points the
  conversation at a real project and deletes the scratch folder if it is empty.
  Files the agent wrote stay where they are; the user is told the path.
- **Cleanup.** Destroying the last conversation of a scratch project deletes
  the scratch project and its folder. The clean-up dialog treats scratch
  folders like worktrees.

## Phasing

| Phase | Scope | User-visible change |
|---|---|---|
| 1 (done) | `Project` and `Workspace` entities, `projects.json`, adoption of manifest paths | Projects survive with zero conversations; rename a project |
| 2 | `folder` workspaces, git-gated panels, scratch projects | Add any folder; start a scratch conversation |
| 3 | `additionalDirectories` wiring, per-workspace git panels, multi-checkout destroy, manifest stamping, memory and cache re-key by project id | Add a second repository to a project; one conversation edits both |

Phase 1 has no new UI beyond a rename field and can ship on its own. Phase 2 is
mostly UI gating. Phase 3 is the large one, and nearly all of its cost is in the
renderer.

## Open questions

- Should additional git workspaces get their own worktree in phase 3, or is
  direct on the current branch enough for a first cut?
- Does a project keep one memory store when it spans two repositories, or one
  per workspace? One per project is simpler and matches how the user thinks
  about it, but repo-specific notes will mix.
- Skill suggestions and known skills are mined per repo path. Per project is
  the obvious replacement, but a project with two repositories will suggest
  skills from both.
