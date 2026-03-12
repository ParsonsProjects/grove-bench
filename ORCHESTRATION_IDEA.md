# Orchestration Layer — Rough Plan

> Status: **Idea / Future exploration**

## Concept

Add an LLM-powered orchestration layer that can decompose a high-level goal into
independent tasks, spawn worktree agents to execute them in parallel, and coordinate
the results — turning Grove Bench from a manually-operated multi-agent tool into an
autonomous project-level planner.

## Current State vs. Orchestrated State

**Today**: User manually creates agents, assigns branches/tasks, monitors progress,
and merges results.

**With orchestrator**: User describes a goal (e.g. "refactor auth module and add
tests"), and the orchestrator decomposes, spawns, monitors, and merges automatically.

## Why Not Just Claude Code Sub-agents?

Claude Code sub-agents are intra-session (shared worktree, sequential, single context
window). The orchestration layer is inter-session: true parallel execution in isolated
worktrees with explicit coordination. They complement each other — sub-agents handle
task-level delegation within a session, the orchestrator handles project-level
delegation across sessions.

## Core Components

### 1. Task Decomposer
- Takes a natural language goal + codebase context
- Outputs a dependency graph of independent work units
- Each unit includes: description, scope (files/modules), branch name, priority
- Must estimate which tasks can run in parallel vs. which block others

### 2. Agent Spawner
- Uses existing `AgentSessionManager` + `WorktreeManager`
- Creates isolated sessions with scoped instructions per task
- Passes environment hints (`.claude/settings.local.json`) to keep agents focused

### 3. Progress Monitor
- Watches agent event streams (already available via IPC)
- Detects: completion, failure, drift from scope, blocked on permission
- Can auto-approve certain tool calls or escalate to user

### 4. Conflict Resolver
- Detects overlapping file changes across worktrees
- Options: (a) pre-scope tasks to non-overlapping files, (b) 3-way merge,
  (c) escalate to user or a dedicated merge agent
- This is the hardest problem

### 5. Result Aggregator
- Merges branches back to a target branch
- Runs validation (tests, lint, build) on the merged result
- Reports summary to user

## Incremental Rollout

### Phase 1 — Assisted decomposition (low risk)
- User describes goal in a dialog
- Single LLM call decomposes into 2-3 tasks with branch names and instructions
- Auto-spawns sessions using existing infra
- User still handles merge/coordination manually

### Phase 2 — Progress tracking
- Orchestrator monitors agent events and surfaces status in UI
- Shows which tasks are done, in progress, or failed
- Notifies user when all tasks complete

### Phase 3 — Auto-merge
- Attempts automatic branch merges when tasks complete
- Falls back to user intervention on conflicts
- Runs validation suite on merged result

### Phase 4 — Full autonomy
- Orchestrator handles the full loop: plan, execute, merge, validate
- Can re-spawn agents to fix issues found during validation
- User approves the final result

## Hard Problems to Solve

- **Task decomposition quality** — LLMs can misjudge dependencies and parallelizability
- **Merge conflicts** — the main bottleneck; two agents touching related code will clash
- **Cost** — orchestrator needs codebase context to plan well, but that context is expensive
- **Scope drift** — agents may wander outside their assigned scope
- **Error recovery** — what happens when one agent in a 3-agent plan fails halfway through

## Open Questions

- Should the orchestrator be a persistent background process or on-demand?
- What model should drive decomposition? (Fast/cheap for planning, capable for execution)
- How much codebase context does the orchestrator need upfront?
- Should there be a "dry run" mode that shows the plan without executing?
- How does this interact with the existing permission model?
