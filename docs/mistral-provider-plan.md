# Mistral Provider Plan

Add [Mistral](https://mistral.ai/) as a second agent provider alongside Claude Code, selectable
per-session, using the existing `AgentAdapter` abstraction in `src/main/adapters/`.

## Summary of the approach

Integrate **Mistral Vibe** — Mistral's open-source CLI coding agent
([mistralai/mistral-vibe](https://github.com/mistralai/mistral-vibe), Apache 2.0, powered by
Devstral 2) — as a new `MistralVibeAdapter`, driven over the
**Agent Client Protocol (ACP)** via the `vibe-acp` binary that ships with it.

This mirrors how the Claude adapter works today (Grove spawns and speaks to a full agent CLI;
the provider owns the agent loop, tools, MCP, and skills) instead of rebuilding an agent loop
on top of the raw Mistral API inside Grove.

Alongside the adapter itself, close the multi-provider wiring gaps that exist today: the main
process already threads an optional `adapterType` through most call sites, but the renderer
never sets it, session resume drops it, and the prerequisite check hardcodes the default
adapter.

## Why Vibe + ACP (and not the alternatives)

| Option | Verdict |
|---|---|
| **Vibe CLI over ACP (`vibe-acp`)** | **Recommended.** Real agent with its own tool suite, per-tool approval flow, session resume, MCP, and skills. ACP is JSON-RPC over the child process's stdio and maps almost 1:1 onto `AgentQueryHandle` (see mapping below). |
| Vibe one-shot mode (`vibe -p --output streaming` + `--resume`) | Fallback only. NDJSON events are easy to parse, but there is no mid-turn permission callback — approvals collapse into coarse `--agent` profiles — and every follow-up message means respawn-and-resume. Keep in reserve if ACP proves unstable. |
| Raw Mistral API loop (`@mistralai/mistralai`) | Rejected. Grove would own tool definitions, execution, sandboxing, and the agent loop — a second agent runtime to maintain. This is the approach the stale `feature/mistral-adapter` branch took. |
| Mistral Code (IDE product) | Not applicable — a VS Code product, no embeddable CLI/protocol surface. |

### Prior art: the `feature/mistral-adapter` branch

An unmerged branch from June 2026 added `src/main/adapters/mistral-agent.ts` on the raw-API
approach. **Do not revive it**: its `start()` opens `mistral.agents.stream()` with empty
messages and no tool execution, `sendMessage()` is a logging stub, and session IDs are
fabricated — it never worked end-to-end, and main has moved ~20 commits since. Two pieces are
worth re-implementing fresh (not cherry-picking): the `mistralApiKey` settings plumbing and
the adapter dropdown in `NewAgentDialog.svelte`.

## Architecture

```
renderer (NewAgentDialog: provider picker)
   │  CreateSessionOpts.adapterType = 'mistral-vibe'
   ▼
agent-session.ts ──► adapterRegistry.get('mistral-vibe')
   ▼
MistralVibeAdapter.start(config)
   │ spawns `vibe-acp` (stdio), speaks ACP JSON-RPC
   │   initialize → session/new (cwd = worktree) → session/prompt
   │   notifications: session/update ──► AgentEvent stream
   │   requests:  session/request_permission ──► config.onPermissionRequest
   ▼
AgentQueryHandle (same contract the Claude adapter fulfils)
```

New files:

- `src/main/adapters/mistral-vibe.ts` — the adapter.
- `src/main/adapters/acp-client.ts` — minimal ACP client: spawn, JSON-RPC framing over
  stdio, request/response correlation, notification dispatch. Prefer the official
  `@zed-industries/agent-client-protocol` TypeScript package if its runtime works in the
  Electron main process; hand-roll the (small) protocol otherwise. Keep it
  provider-agnostic — it becomes the base for future ACP agents (Gemini CLI, Codex, etc.,
  per `DESIGN.md` future work).
- `src/main/adapters/mistral-vibe.test.ts`.

### ACP ↔ Grove contract mapping

| Grove (`AgentQueryHandle` / `AdapterConfig`) | ACP / vibe |
|---|---|
| `start(config)` → `system_init` event | `initialize` + `session/new` (cwd = `config.cwd`); emit `system_init` with the ACP session id and active model |
| `sendMessage({text, images})` | `session/prompt` (ACP content blocks; images if vibe's capabilities advertise them) |
| `events` (assistant_text / thinking / tool use / tool result / partial_*) | `session/update` notifications: `agent_message_chunk` → `partial_text`+`assistant_text`, `agent_thought_chunk` → thinking, `tool_call` → `assistant_tool_use`, `tool_call_update` → `tool_progress`/`tool_result` |
| `result` event per turn | `session/prompt` response (`stopReason`) → emit `result` |
| `config.onPermissionRequest` | `session/request_permission` → map tool + options into a `PermissionRequest`; apply the same pre-filters as the Claude adapter first (allowlist, deny rules, allow rules, `alwaysAllowedTools`) |
| `abort()` / `interrupt()` | `session/cancel` (turn-level); `abort()` also kills the child on timeout |
| `close()` | end stdin / terminate child process |
| `getSessionId()` / resume | ACP session id, persisted in the worktree manifest; resume via `session/load` if `vibe-acp` advertises `loadSession`, else fall back to spawning `vibe --resume <id>` semantics — verify during the spike (see Risks) |
| `setModel()` | ACP `session/set_model` if advertised; otherwise restart the session with the model in config and mark `modelSwitching: false` |
| Tool categories | Map vibe tool names (`read_file`, `write_file`, `edit`, `bash`, `grep`, `task`, MCP `{server}_{tool}`) → `ToolCategory`; ACP also tags `tool_call` with a `kind` (read/edit/execute/fetch…) which is a better source than name-sniffing |

### Capability flags (initial)

```ts
capabilities = {
  permissions: true,          // via session/request_permission
  permissionModes: true,      // map default/plan/acceptEdits → vibe agent profiles (ask/plan/accept-edits)
  resume: true,               // pending spike confirmation of session/load
  modelSwitching: true,       // pending spike confirmation
  thinking: false,            // v1: no runtime thinking control (Magistral later)
  mcpControl: false,          // v1: no runtime MCP toggling
  plugins: false,
  skills: true,               // vibe implements the same SKILL.md spec (.vibe/skills/, .agents/skills/)
  imageAttachments: false,    // v1; enable if ACP prompt capabilities include image
  structuredOutput: false,
  sandbox: false,
};
```

Grove's `PermissionMode` maps onto vibe agent profiles: `default` → `ask`, `plan` → `plan`,
`acceptEdits` → `accept-edits`. Settings-level `bypassPermissions` → `--auto-approve`
(respect the existing `disableBypassMode` setting).

### Models

`getModels()` (hardcoded like the Claude adapter; same "fetch dynamically" TODO applies):

| id | label | context |
|---|---|---|
| `devstral-2512` | Devstral 2 | 256k |
| `mistral-large-2512` | Mistral Large 3 | 256k |
| `codestral-2508` | Codestral | 256k |
| `magistral-medium-2509` | Magistral Medium | 128k |
| `mistral-medium-latest` | Mistral Medium | 128k |

Default: `devstral-2512` (the model Vibe is built around). Verify exact ids/windows against
https://docs.mistral.ai during implementation.

### Prerequisites & auth

`checkPrerequisites()`:

1. Locate `vibe-acp`/`vibe` via `where.exe`, then probe known install locations
   (`%USERPROFILE%\.local\bin`, uv tool shims) — same pattern as the Claude adapter's
   Windows PATH workaround.
2. Missing → `installInstructions: 'Install with: uv tool install mistral-vibe (or pip install mistral-vibe)'`.
3. Auth: `MISTRAL_API_KEY` from Grove settings (see below) or `~/.vibe/.env`. Cheap
   validation: hit `GET https://api.mistral.ai/v1/models` with the key.
4. `authErrorMessage`: "Set your Mistral API key in Settings, or run `vibe --setup` (keys at
   https://console.mistral.ai/)."

The adapter passes the key to the child via `config.extraEnv` → `MISTRAL_API_KEY` so Grove's
stored key wins without touching the user's `~/.vibe/.env`.

`generateText()` (memory auto-save/compact, commit messages): implement with a plain
`chat/completions` HTTPS call using the same key and a cheap model (`mistral-small-latest`) —
no need to spin up the agent for one-shot extraction.

`generateWorktreeSettings()`: write `.vibe/config.toml` into the worktree with conservative
tool permissions mirroring the intent of the Claude adapter's `.claude/settings.local.json`
(deny access outside the worktree where vibe's config allows expressing it).

## Multi-provider wiring gaps to close (provider-agnostic groundwork)

These are pre-existing gaps; fixing them is Phase 1 and benefits any second adapter:

1. **Persist the adapter id per worktree.** Add `adapterType` to `ManifestEntry`
   (`worktree-manager.ts:15-34`) with a getter alongside `getProviderSessionId`/`getModel`,
   and pass it in `SESSION_RESUME` (`ipc.ts:258-291`) — today resume always falls back to the
   registry default, which would silently swap a Mistral session to Claude.
2. **Renderer provider picker.** `NewAgentDialog.svelte` sends only
   `{repoPath, branchName, direct}`; add an adapter dropdown fed by
   `window.groveBench.listAdapters()` (IPC already implemented at `ipc.ts:897`, unused) and
   include `adapterType` in `CreateSessionOpts`. Hide the dropdown when only one adapter's
   prerequisites pass.
3. **Per-adapter prerequisites.** `prerequisites.ts:37-70` checks only
   `adapterRegistry.getDefault()`. Change `PrerequisiteStatus.agent` to a per-adapter map
   (`agents: Record<id, …>`), and relax `PrerequisiteCheck.svelte` so the app only blocks
   when *no* adapter is available — a missing optional provider shows in the picker/settings
   instead of gating startup.
4. **Model picker scoping.** `StatusBar.svelte:473` calls `getModels()` with no
   `adapterType`; pass the session's adapter id (surface it on the session entry — 
   `SessionInfo.agentType` already exists at `shared/types.ts:57` but isn't shown in the UI).
   Same for the MCP-config and plugin stores, which drop the optional `adapterType` arg.
5. **Settings scoping.**
   - Add `mistralApiKey: string` to `GroveBenchSettings` (masked input in
     `SettingsPanel.svelte`, mirrored in `stores/settings.svelte.ts`).
   - Migrate global `defaultModel: string` → `defaultModelByAdapter: Record<string, string>`
     in `mergeWithDefaults()` (`settings.ts:62-73`, where prior renames live); the Settings
     panel becomes a per-provider picker instead of free text.
   - `toolAllowRules`/`toolDenyRules` keep Claude-style patterns; document that they match on
     the adapter-reported tool names (patterns like `Bash(npm *)` simply won't match vibe's
     `bash` tool — acceptable v1, revisit if confusing).
6. **Cosmetic strings.** `SettingsPanel.svelte:648` "Servers from your Claude Code
   configuration" → use the adapter's `displayName`; `lib/skill-prompt.ts` skill-path prompt
   already hedges but should mention `.vibe/skills/` when the session's adapter is vibe.
7. **Registration & default.** Register `MistralVibeAdapter` in `adapters/index.ts` *after*
   Claude (registry defaults to first-registered, so Claude stays default).

## Phases

**Phase 0 — spike (½–1 day).** Install vibe on Windows, run `vibe-acp` by hand, capture
its `initialize` capability response, one full prompt turn with a tool approval, and confirm
`session/load` + model selection support. This resolves the two open capability questions
(resume, setModel) before code is committed.

**Phase 1 — groundwork (provider-agnostic).** Items 1–5 above + tests. Ship independently;
no behavior change with a single adapter registered.

**Phase 2 — ACP client + adapter.** `acp-client.ts`, `mistral-vibe.ts`, registration,
prerequisites, settings key pass-through, `generateText`. Behind the picker from Phase 1.

**Phase 3 — polish.** Adapter badge on session tiles/status bar, per-provider default model
UI, `generateWorktreeSettings`, docs (`DESIGN.md` future-work section, `CLAUDE.md` tree,
`TODO.md` line 8 check-off), README.

## Testing

Follow the existing adapter test style (pure-function heavy, no live child process):

- `mistral-vibe.test.ts`: capabilities, `getModels()`, tool-name/kind → `ToolCategory`,
  permission-mode → profile mapping, and a `transformAcpUpdate()` suite mirroring
  `transformMessage()` in `claude-code.test.ts` (session/update fixtures → `AgentEvent[]`).
- `acp-client.test.ts`: JSON-RPC framing, request/response correlation, permission
  round-trip against a scripted fake stdio stream.
- Extend `prerequisites.test.ts` for the per-adapter map, and `worktree-manager.test.ts` for
  manifest `adapterType` persistence/resume.
- `auth-error.test.ts`'s fake-adapter pattern already covers registry behavior with two
  adapters; extend rather than duplicate.

## Risks & open questions

- **Windows support is the top risk.** Grove is Windows-native; vibe is a Python tool that
  "works on Windows, but officially supports and targets UNIX environments". The Phase 0
  spike on a real Windows box is the go/no-go gate. Mitigations: uv-managed install
  (`uv tool install mistral-vibe`) avoids most Python-env pain; the one-shot
  `--output streaming` mode is the fallback surface if `vibe-acp` misbehaves on Windows.
- **ACP feature coverage** (session/load, set_model, image blocks) is capability-negotiated
  at `initialize`; the adapter should read the advertised capabilities at runtime rather
  than assume, and degrade the corresponding `AgentCapabilities` flags.
- **Usage/cost events**: ACP may not report token usage per turn the way the Claude SDK
  does; if absent, the status bar simply shows no context meter for Mistral sessions
  (`usage`/`result.contextWindow` events just aren't emitted — the UI already tolerates
  that).
- **Model ids drift**: verify against Mistral docs at implementation time; same hardcoding
  caveat as the Claude adapter (`TODO.md:111`).
