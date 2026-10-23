# Projects, Workspaces and Scratch Conversations

> **Status: Proposal, Goal 1 partly built, Goal 4 prototyped.** A minimal Goal 1
> is in: a folder without git can be added as a project (see "Goal 1: what was
> built"). Conversation groups are a prototype (see "Groups: prototype"). There is
> still no `Project` record or workspace list. The UI, help and docs already say
> "conversation" and "project"; the code still says "session" and "repo" on
> purpose (see `CLAUDE.md`, Terminology).

## Goals

1. A project does not have to be a git repository.
2. One conversation can edit several repositories at once.
3. A conversation can start with no project at all, in a scratch folder under
   the app's data directory.
4. Conversations in different projects that belong to one piece of work can be
   seen and handled together (see "Groups: prototype").

## Where we are today

Everything below is what the code does now, so the plan can be checked against it.

- **A project is only a remembered path.** `app-state.json` keeps the list of
  added projects in order (`projects`, via `rememberProject()` and
  `listProjects()` in `src/main/app-state.ts`), merged with the distinct
  `repoPath` values of manifest entries (`listRepos()` in
  `src/main/worktree-manager.ts`). A project with no conversations stays until
  it is removed. There is still no record with a name, kind or settings.
- **Adding a project no longer requires git.** The folder picker in
  `src/main/ipc.ts` calls `inspectProjectFolder()` (`src/main/project-path.ts`),
  which returns a git repository's top level or a plain `folder`. The renderer
  adds a `folder` as it is.
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

Projects are stored in a new `projects.json` under `userData`, written through
the same debounced writer pattern as `app-state.ts`. The worktree manifest keeps
its job (per-checkout bookkeeping) but each entry gains `projectId` and
`workspaceId`.

### Migration

On first launch with the new code:

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
  conversation always runs direct on the folder. The draft conversation's
  branch picker (`DraftStartPicker`) offers only "Project folder" when every
  workspace in the chosen project is a folder.
- **What the UI hides.** Changes, Checkpoints (branch and turn diffs), Git ops,
  Create PR, sync status and the PR watcher all need git. For a folder
  workspace each shows one line: "This workspace is not a git repository." The
  Terminal, Activity, Memory and Skills panels work as they do now.
- **What still works without git.** Dependency install, memory, skills and MCP
  config all key off the folder. Rewinding files does not: checkpoints are git
  commits under `refs/grove/checkpoints/<sessionId>/` (`src/main/checkpoints.ts`),
  not the SDK's file checkpoints, so without git only the conversation can be
  rewound. (An earlier draft of this plan said otherwise.)
- **Orphan sweep.** `cleanupOrphans()` runs `git worktree` commands per
  repository. It skips `folder` workspaces.

### Goal 1: what was built

A minimal version, without the `Project` record:

- **Adding.** `REPO_SELECT` returns `{ kind: 'git' | 'folder', path }` and a
  `folder` is added straight away, with no extra step. There is no in-app
  "set up git"; the user runs `git init` themselves. When git isn't installed,
  every pick is a `folder`.
- **Knowing the kind.** The renderer keeps `folderRepos` in memory, rebuilds
  it at launch from `repoKind()` (`git`, `folder` or `missing`) and checks again
  when a draft opens. Main decides each new conversation's `noGit` itself and
  returns it. A folder with a `.git` that git refuses stays `git` when git is
  installed, so git's error shows instead of the agent editing in place.
- **Conversations.** A folder project's draft only offers the project folder.
  `SESSION_CREATE` decides `noGit` itself, from `projectKind()` or from the
  conversation it is attached to, refuses a worktree in a folder,
  and registers a direct entry with `noGit: true` and an empty branch.
  `AgentSessionManager` uses `noGitCheckpoints` for such a folder.
- **What the UI hides.** Changes and Checkpoints show why they need git; the
  rewind dialog resets only the conversation; git status, sync and PR lookups
  return empty for `noGit` conversations. A missing or too-old git is warned
  about only at the top of the Changes tab (`GitNotice`), not app-wide.
- **Orphan sweep.** Phase 3 of the startup sweep drops a direct entry only when
  its folder is gone, so a `noGit` entry isn't dropped for not being a
  repository, and a broken git at launch drops nothing.
- **Not done.** No `Project` record with a kind or settings; the path list in
  `app-state.json` stands in for it. Git projects also get a heads-up on the
  draft screen when git has no name and email.

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

## Groups: prototype

Work that spans repositories is usually short-lived (one feature, merged within
days) and done by one agent per repository, two to four at a time, rather than
by one agent editing several. For that, a group of conversations is enough and
much cheaper than Goal 2: each conversation keeps its own project, `cwd`,
CLAUDE.md, skills and MCP config, so nothing keyed by repo path changes.

What the prototype does:

- **Data.** `ConversationGroup` (`src/shared/types.ts`): id, name and
  conversation ids. Stored as `groups` in `app-state.json`
  (`saveConversationGroups()` in `src/main/app-state.ts`, debounced and flushed
  on quit). Loading drops malformed entries and repeated ids. While the file
  can't be read, loading says so (null) rather than "no groups", and the
  renderer saves nothing and hides groups until a load works, so a passing lock
  can't wipe them.
- **Rules.** `groupStore` (`src/renderer/stores/groups.svelte.ts`). A
  conversation is in at most one group, and a group always has one: it is made
  with its first conversation (from the heading, when that conversation's first
  message is sent) and goes when its last leaves or is deleted
  (`forgetConversation()`).
- **Sidebar.** A Groups section between Conversations and Projects
  (`SidebarGroups.svelte`), shown once there are two projects or any group. The
  conversation menu adds New Group, Add to, Move to and Remove from. A grouped
  row shows its group's name. The group header has attention counts, a + for a
  new conversation, Ungroup, and a menu with Rename and Close all conversations.
- **New conversation in a group.** The draft opens in the first project the
  group has nothing in yet, with the group's branch name (the first member's
  real branch: not a placeholder, not direct); in a project the group already
  has a conversation in, it gets an automatic name. Whether that branch is new
  or continued is decided at create time: the draft sends `continueBranch`, and
  `SESSION_CREATE` continues the branch when the project has it, or refuses
  when another checkout (a conversation, or the project folder) holds it. The
  draft bar shows the group and can leave it; opening the draft from a
  project's + also leaves it.

Not done:

- Deleting a group's conversations together (the per-conversation and
  remove-project checks would need to run over the group).
- Sharing context between the agents in a group, such as a group note added to
  each conversation's prompt. Today the user carries the API contract between
  them.
- The conversation finder, the landing and the rail know nothing about groups.
- Membership lives in `app-state.json`, not the manifest. A conversation the
  startup sweep drops stays listed in its group's ids but isn't shown.

If projects get a `Project` record later, groups don't depend on it: they hold
conversation ids only.

## Phasing

| Phase | Scope | User-visible change |
|---|---|---|
| 1 | `Project` and `Workspace` entities, `projects.json`, migration, memory re-key | Projects survive with zero conversations; rename a project |
| 2 | `folder` workspaces, git-gated panels, scratch projects | Add any folder; start a scratch conversation |
| 3 | `additionalDirectories` wiring, per-workspace git panels, multi-checkout destroy | Add a second repository to a project; one conversation edits both |

Phase 1 has no new UI beyond a rename field and can ship on its own. Phase 2 is
mostly UI gating. Phase 3 is the large one, and nearly all of its cost is in the
renderer.

## Open questions

- Are groups enough for cross-repository work, so Goal 2 can wait? Goal 2 only
  pays off for tightly coupled changes that one agent should make on both sides.

- Should additional git workspaces get their own worktree in phase 3, or is
  direct on the current branch enough for a first cut?
- Does a project keep one memory store when it spans two repositories, or one
  per workspace? One per project is simpler and matches how the user thinks
  about it, but repo-specific notes will mix.
- Skill suggestions and known skills are mined per repo path. Per project is
  the obvious replacement, but a project with two repositories will suggest
  skills from both.
