# Grove Bench — User Stories

## Repository Management

1. **As a developer, I want to add a local Git repository via folder picker** so that I can start working with AI agents on my project.
2. **As a developer, I want to remove a repository from the sidebar** so I can keep my workspace focused on active projects.
3. **As a developer, I want to see all my added repos listed in the sidebar** so I can quickly switch between projects.
4. **As a developer, I want orphaned worktrees detected and cleaned up when I add a repo** so stale state from previous sessions doesn't accumulate.

## Single-Agent Sessions

5. **As a developer, I want to create a new agent session on a named branch** so that Claude works in an isolated worktree without touching my main checkout.
6. **As a developer, I want to choose a base branch when creating a session** so the agent starts from the correct codebase state.
7. **As a developer, I want to run a session in "direct" mode (no worktree)** so the agent can operate directly on my repo root for quick tasks.
8. **As a developer, I want to type prompts and send them to a running agent** so I can direct the AI's work interactively.
9. **As a developer, I want to reference files in my prompt using an @-mention picker** so I can quickly point the agent at specific files without typing full paths.
10. **As a developer, I want to see structured output blocks (text responses, tool calls, bash output, file operations, diffs, thinking)** so I understand exactly what the agent is doing at each step.
11. **As a developer, I want to review file changes in a diff panel** so I can inspect what the agent modified before approving.
12. **As a developer, I want to approve or deny permission requests from the agent** so I maintain control over destructive or sensitive operations.
13. **As a developer, I want to "allow always" for a specific tool pattern** so I'm not repeatedly prompted for safe, repetitive actions.
14. **As a developer, I want to switch the agent's mode (default, plan, acceptEdits)** so I can control how much autonomy the agent has mid-session.
15. **As a developer, I want to stop a running session and later resume it** so I can manage agent execution across work sessions. *(Resume happens automatically when clicking a stopped session's tab.)*
16. **As a developer, I want to search through session message text and thinking blocks** so I can find specific agent output in a long conversation. *(Does not search tool inputs, file paths, or bash command content.)*
17. **As a developer, I want to manage multiple sessions as draggable, closable, reorderable tabs** so I can multitask across different tasks or repos.
18. **As a developer, I want inactive tabs to flash when their session finishes running** so I don't miss important completions in background sessions.
19. **As a developer, I want to quick-find sessions with Ctrl+R** (searches by branch name, repo, and first prompt) so I can navigate efficiently when many sessions are open.

## Orchestration (Multi-Agent)

20. **As a developer, I want to describe a high-level goal and have it decomposed into 2-5 parallel tasks** so I can accomplish complex work faster with multiple agents.
21. **As a developer, I want to review the generated task plan and edit task descriptions, instructions, and branch names before execution** so I can correct the plan before committing resources. *(Task scope, dependencies, and priority are not editable in the UI.)*
22. **As a developer, I want tasks to run in parallel across isolated worktrees** so agents don't interfere with each other's changes.
23. **As a developer, I want to see real-time progress on each orchestration task** (status, live summaries, completion counter) so I know how the job is progressing.
24. **As a developer, I want task `dependsOn` relationships respected** so that dependent tasks don't start until their prerequisites complete. *(Note: the `parallelizable` flag is tracked but not independently enforced.)*
25. **As a developer, I want a circuit breaker to halt remaining tasks** if a failure threshold is reached, so I don't waste time and API credits on a doomed plan. *(Known bug: threshold stored as percentage 0-100 but compared as ratio 0-1, so the breaker rarely triggers.)*
26. **As a developer, I want completed task branches merged via an integration agent** that runs `git merge --no-ff` with AI-assisted conflict resolution, so results are combined back to the base branch.
27. **As a developer, I want to be notified when the merge agent fails and retry it** so failed integrations aren't silently dropped. *(There is no interactive conflict editor — "Resolve" retries the merge agent.)*
28. **As a developer, I want orchestration jobs to persist across app restarts** so a long-running job isn't lost if I close the app.

## Docker Isolation

29. **As a developer, I want orchestration subtasks to run inside Docker containers** so agents are sandboxed from my host system. *(Docker isolation applies to orchestration subtasks only, not single-agent sessions.)*
30. **As a developer, I want resource limits enforced on containers** (2 GB RAM, 2 CPUs, 256 PIDs) so a runaway agent can't consume all my system resources. *(Limits are hardcoded, not user-configurable.)*

## Configuration & Settings

31. **As a developer, I want to set a default permission mode** (default, plan, acceptEdits, bypassPermissions) so sessions start with my preferred safety level.
32. **As a developer, I want to configure tool allow/deny rules** (e.g., allow `Bash(npm run *)`) so I can pre-approve common safe patterns.
33. **As a developer, I want untracked config files (.env, .npmrc, etc.) auto-detected and copied into new worktrees** so agents have the config they need to build and run. *(Auto-detected from a default pattern list; no UI to customize per-repo.)*
34. **As a developer, I want to set task timeouts for orchestration** so I can control how long each subtask runs. *(The `maxParallelAgents` setting exists in the UI but is not currently enforced.)*
35. **As a developer, I want to choose a theme** (dark, light, or system) to match my preferences.
36. **As a developer, I want to manage Claude Code plugins** via a dedicated panel so I can extend agent capabilities.

## Prerequisites & Onboarding

37. **As a new user, I want a prerequisite check on startup** (Git version >= 2.17, Claude Code installed, auth status) so I know exactly what's missing before I try to use the app.
38. **As a new user, I want the app to block interaction with a clear overlay when prerequisites aren't met** so I'm guided toward fixing the issue.

## Persistence & Window Management

39. **As a developer, I want the app to remember my window position, size, and active tab across restarts** so I can pick up where I left off.

## Debugging

40. **As a developer, I want file-based logging written to `%APPDATA%/grove-bench/logs/`** so I can diagnose issues when something goes wrong.

---

## Known Issues

- **Story 25**: Circuit breaker comparison bug — `failedCount / totalCount >= threshold` should be `>= threshold / 100`.
- **Story 34**: `maxParallelAgents` is stored in settings but `spawnTasks` launches all ready tasks without checking it.
- **Story 29**: Docker flag is never passed for single-agent sessions in the IPC handler.
