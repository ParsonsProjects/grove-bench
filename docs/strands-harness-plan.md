# Strands Harness SDK — Integration Investigation

> **Status: Investigation only.** No code has been changed. This doc records what the Strands Harness SDK is, how it maps onto Grove Bench's adapter interface, the blockers found, and a suggested path. Findings come from reading the published npm packages (`@strands-agents/harness@0.1.0`, `@strands-agents/sdk@1.17.0`) and the project's GitHub README; the strandsagents.com docs site was not reachable from the investigation environment.

## What it is

Strands Agents is AWS's open-source agent framework (Apache 2.0) for Python and TypeScript. It ships in layers:

| Package | Version (npm, 22 Sep 2026) | Role |
|---|---|---|
| `@strands-agents/sdk` | 1.17.0 / 1.18.0 | The core "Harness SDK": `Agent` loop, tools, MCP, hooks, interventions, sessions, memory, sandboxes, context management. Node `>=22` in `engines`. |
| `@strands-agents/harness` | 0.1.0 | "Strands harness": one call, `createHarness()`, returns a preconfigured `Agent` with shell/file/web tools, todos, environment context, context offloading, file sessions, long-term memory and a tuned system prompt. Pins `@strands-agents/sdk >=1.17.0 <1.18.0`. Node `>=20`. |
| `@strands-agents/cli` | — | A `strands` terminal command wrapping the same agent. |

The first public harness releases landed on 21 September 2026 ([GitHub](https://github.com/strands-agents/harness-sdk), [MarkTechPost](https://www.marktechpost.com/2026/09/21/aws-strands-agents-team-releases-strands-harness/)). The harness is model-agnostic: `model` takes a `provider/name` string for `bedrock`, `bedrock-mantle`, `anthropic`, `openai`, `google`, `ollama`, `litellm`, or a `Model` instance. The default is Claude Opus on Amazon Bedrock. Only the provider you use needs its peer dependency (`@anthropic-ai/sdk`, `openai`, `@google/genai`); Bedrock needs none.

Two things matter up front for Grove Bench:

1. **It is a library, not a product.** Claude Code is a CLI with its own auth, config files, plugins and permission UI that Grove drives through the Agent SDK. Strands is a set of building blocks; Grove would *be* the harness host and own everything the CLI otherwise provides (working directory, permissions, session storage, credentials).
2. **Auth is API keys or AWS credentials only.** `AnthropicModel` takes `apiKey` (or `ANTHROPIC_API_KEY`), Bedrock uses the AWS credential chain. There is no way to use a Claude Pro/Max subscription login through Strands. That is a product decision, not a technical one.

## Fit with the adapter interface

Grove's `AgentAdapter` / `AdapterConfig` / `AgentQueryHandle` (`src/main/adapters/types.ts`) map onto Strands as follows.

| Grove concept | Strands equivalent | Notes |
|---|---|---|
| `start(config)` → handle | `await createHarness({...})` then `agent.stream(text)` per turn | Strands is invoke-per-turn, not a long-lived input stream. The handle needs a small queue: `sendMessage` runs `agent.stream()` if idle, otherwise queues. Claude's `Query` already hides this. |
| `AgentEvent` stream | `AgentStreamEvent` union: `modelStreamUpdateEvent` (text / reasoning deltas), `contentBlockEvent` (finished `TextBlock` / `ToolUseBlock` / `ReasoningBlock`), `beforeToolCallEvent`, `toolResultEvent`, `modelMessageEvent`, `agentResultEvent`, `interruptEvent` | Direct mapping to `partial_text`, `partial_thinking`, `assistant_text`, `thinking`, `assistant_tool_use`, `tool_result`, `result`. Usage comes from `modelMetadataEvent.usage` inside `modelStreamUpdateEvent`. |
| `interrupt()` | `agent.cancel()` | Cooperative; a running tool finishes unless it honours `cancelSignal`. `stopReason: 'cancelled'`. No process to kill, so cheaper than Claude's respawn. |
| `abort()` / `close()` | `agent.cancel()` + `agent.memoryManager?.flush()` | Memory extraction is background; flush at shutdown or facts are lost. |
| `onPermissionRequest` | Custom `InterventionHandler.beforeToolCall` returning `confirm(prompt, { response })` or `{ type: 'deny' }` | Inline mode: await Grove's handler, then return the answer. `BeforeToolCallEvent.toolUse` has `name`, `toolUseId`, `input`, so the existing allow/deny rule matching (`matchToolRule`, `toolCallSpecifier`) reuses as-is. The vended `HumanInTheLoop({ ask })` is not enough on its own because `ask` only receives a prompt string. |
| `permissionMode` | Built app-side | `default` → ask for everything but read; `acceptEdits` → allow `read`/`write`/`edit`, ask `shell`; `readSafe` → same as today; `auto` → `HumanInTheLoop({ classifier: true })` (LLM risk classifier). **`plan` has no equivalent** and should be left out of `getControls()`. |
| `thinking` control | `effort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'` | Mapped per provider by the harness. Applied at `createHarness()` time, so a mid-session change means rebuilding the agent on the same session id. |
| `setModel` | Rebuild agent on the same session id | `agent.model` is assignable, but effort/caching are resolved at build time. Rebuild + resume is simpler and safe because sessions persist per message. |
| `resume` (`resumeSessionId`) | `session: { id, dir }`; `agent.sessionId` | Session id is sanitised to `[a-z0-9_-]`. `getSessionId()` returns `agent.sessionId`. |
| `resumeAtUuid` (rewind) | `SessionManager.listSnapshotIds()` / `restoreSnapshot()` | Immutable snapshots exist but are trigger-based; needs a `snapshotTrigger` per user turn. Different mechanism, roughly equal capability. |
| `memoryOperations` | Plain `tool({...})` definitions | No MCP server needed. Register `grove_memory_*` tools directly in `tools`; auto-allow them in the intervention handler. |
| `skills` | `AgentSkills` plugin, `skills: ['<worktree>/.claude/skills']` | Reads `SKILL.md` with frontmatter `name`/`description`, so Grove's `listSkills`/`addSkill` output is compatible. Do **not** use the default `./.agent/skills`. |
| MCP servers | `mcpServers: { name: { command, args } }` | Standard config shape. Grove can feed the servers from `listConfiguredMcpServers()`. Tool names become `<server>_<tool>`, not `mcp__server__tool`, so `categorizeToolName` needs a second mapping. Runtime `listMcpServers`/reconnect is not exposed by the harness; set `mcpControl: false` initially. |
| `structuredOutput` | `structuredOutputSchema` (Zod) | Grove passes a JSON schema; would need conversion. Low priority. |
| `sandbox` | `sandbox: Sandbox` | See blockers. |
| Background tasks (`task_*` events) | `subagent` tool + `backgroundTasks` | Runs in the background and blocks the parent until done by default; there is no per-task stop API surfaced. Skip in v1 (`builtinTools: { subagent: false }`) or map `toolStreamUpdateEvent` to `task_progress` later. |
| `getUsage` | none | API-key billing has no plan windows. `capabilities.usage = false`. |
| `checkPrerequisites` | none | Check for `ANTHROPIC_API_KEY` / AWS credentials and do a cheap `model.countTokens()` or a one-token call. `authErrorMessage` should say "Set ANTHROPIC_API_KEY or configure AWS credentials". |
| `generateText` (memory autosave) | `new Agent({ model, systemPrompt, tools: [] }).invoke(text)` | Straightforward. |

Tool categories for the renderer: `shell` → `bash`, `read` → `read`, `write`/`edit` → `edit`, `web_fetch` → `web_fetch`, `web_search` → `web_fetch`, `subagent` → `agent`, `todo_write` / `programmatic_tool_caller` / `search_memory` → `other`.

## Blockers and risks

Ranked by how much they change the plan.

### 1. Windows: the default sandbox needs a POSIX `sh`

`NotASandboxLocalEnvironment.executeStreaming` (the default sandbox) spawns:

```js
spawn('sh', ['-c', `cd ${shellQuote(cwd)} && ${envPrefix}${command}`])
```

and `executeCodeStreaming` pipes a `base64 -d` heredoc into the interpreter. The harness's `shell` tool, `web_fetch` (`transport: 'curl'` by default) and the `environment` plugin (`uname`, `pwd` probes) all route through this. On a stock Windows machine `sh` is not on `PATH` (Git for Windows only puts `Git\cmd` there), so the shell tool fails with ENOENT. The `environment` probes fail quietly, so the model would just not get platform/cwd lines.

**Fix:** implement a `GroveWindowsSandbox extends Sandbox` in `src/main/adapters/strands/` that spawns via `child_process` with `{ cwd, shell: true }` (or a pinned Git Bash / PowerShell path), implements `readFile`/`writeFile`/`removeFile`/`listFiles` with `fs/promises` against the worktree root, and pass it as `sandbox`. Set `web_fetch: { transport: 'direct' }`. This is maybe 150 lines but it is the first thing to prototype because everything else depends on it.

### 2. Working directory is `process.cwd()` unless overridden

The local sandbox resolves relative paths and the default `cwd` against `process.cwd()`, which for an Electron app is wherever it was launched. Grove runs many concurrent worktrees, so each session must get its own `Sandbox` instance rooted at `config.cwd`. Same for state directories, which default to paths relative to the process:

| Option | Default | Grove should use |
|---|---|---|
| `session.dir` | `./.agent/sessions` | `<userData>/strands/sessions` |
| `memory.dir` | `./.agent/memory` | `<userData>/strands/memory/<repo>` or `memory: false` and rely on Grove's own memory tools |
| `skills` | `./.agent/skills` | `<worktree>/.claude/skills` |

If left at defaults the harness writes `.agent/` into the worktree and dirties `git status`, which breaks Grove's diff view and cleanup logic.

### 3. Node version: SDK says `>=22`, Electron 33 ships Node 20.18.1

`@strands-agents/sdk` declares `engines.node >=22.0.0`; Electron v33.3.1's `DEPS` pins `node_version: v20.18.1`. `npm install` will print an `EBADENGINE` warning (not an error unless `engine-strict` is set). A scan of the built SDK for Node 22-only APIs found nothing hard: `Symbol.dispose`/`Symbol.asyncDispose` (Node 20.4+), a guarded `process.getBuiltinModule`, global `fetch`/`crypto`. The harness itself declares `>=20`. This needs a real runtime test inside Electron before committing to it; a Node-only test would not prove it.

### 4. Dependency weight and native modules

`@strands-agents/sdk` hard-depends on `@aws-sdk/client-bedrock-runtime` and `@smithy/*` (6.7 MB unpacked). The harness adds OpenTelemetry exporters, `esbuild`, `tsx`, and `@pydantic/monty` (a sandboxed Python interpreter used by `programmatic_tool_caller`, shipped as prebuilt binaries including `win32-x64-msvc`). `electron-builder.yml` already `asarUnpack`s `**/*.node`, and `postinstall` runs `electron-rebuild`, so prebuilt binaries should be fine, but the installer grows noticeably. Disabling `programmatic_tool_caller` avoids loading monty at runtime but not installing it.

### 5. ESM-only packages in a CJS main process

Both packages are `"type": "module"`. `claude-code.ts` already solves this with a `new Function('specifier', 'return import(specifier)')` dynamic import; the same trick works here. `vite.main.config.mjs` bundles everything that is not a Node builtin or in `externalPatterns`, so the two packages would need adding to `externalPatterns` (like `node-pty`) or the dynamic import specifier must stay opaque to Rollup.

### 6. UI gaps that exist regardless of provider

- `NewAgentDialog.svelte` has no adapter picker; `createSession` always resolves the default adapter.
- `prerequisites.ts` only checks `adapterRegistry.getDefault()`.
- `SettingsPanel.svelte` already lists every registered adapter's controls (per-adapter defaults), so that side is ready.

These are needed for any second adapter, Strands or Codex (`TODO.md` line 10).

## Recommendation

Feasible as a second adapter, and the adapter interface holds up well: nothing in `AgentAdapter` needs changing beyond leaving `plan` out of the controls. The real work is not the mapping, it is owning the host responsibilities (Windows sandbox, cwd, state dirs, credentials) that Claude Code's CLI does for us today.

Suggested order:

1. **Spike (half a day):** `npm install` both packages in the repo, add a `GroveWindowsSandbox`, and run `createHarness({ model: 'anthropic/...', sandbox, session: false, memory: false, skills: false, builtinTools: { subagent: false, programmatic_tool_caller: false, web_search: false }, printer: false })` from the Electron main process on Windows. This answers blockers 1, 3, 4 and 5 in one go. Stop here if the Node 20 runtime breaks.
2. **Adapter (2 to 3 days):** `src/main/adapters/strands/` with `StrandsAdapter` (`id: 'strands'`), event transform, intervention handler, turn queue, memory tools, prerequisite check. Register it behind a setting so the default stays Claude Code.
3. **UI (1 day):** adapter picker in the new conversation dialog, per-adapter prerequisites, second tool-name mapping in `categorizeToolName`.
4. **Later:** rewind via session snapshots, subagent → task events, MCP runtime control, structured output.

A zero-code alternative worth knowing about: the `strands` CLI (`npm install -g @strands-agents/cli`) runs in Grove's existing PTY terminal today. That gives no structured events, permissions or Focus view, so it is a demo, not an integration.

## Open questions

These change the scope and should be settled before step 2:

1. **Which providers matter?** Anthropic API key, Bedrock (needs AWS CLI credentials on the user's machine), or "any model"? Bedrock is the harness default and needs no peer dependency, but Grove's users are Claude subscription users today.
2. **Is API-key-only auth acceptable** for this adapter, given Claude Code sessions use the subscription?
3. **Goal:** a second agent option in the app, or a way to benchmark the Strands harness against Claude Code on the same repo? The latter argues for keeping tool sets and permission behaviour as close as possible and for a cost/usage view (`TODO.md` line 86).
4. **Installer size:** is roughly 10 to 20 MB of extra dependencies (AWS SDK, OpenTelemetry, monty binaries) acceptable, or should the Strands adapter be an optional install?
5. **Where should Strands state live?** App data (recommended) or inside the worktree with a `.gitignore` entry?

## Sources

- [strands-agents/harness-sdk on GitHub](https://github.com/strands-agents/harness-sdk) — monorepo README: packages, install, quick start, license.
- [`@strands-agents/harness` on npm](https://www.npmjs.com/package/@strands-agents/harness) — version 0.1.0, dependencies, peer dependencies, `engines`.
- [`@strands-agents/sdk` on npm](https://www.npmjs.com/package/@strands-agents/sdk) — version 1.17.0 / 1.18.0, `engines.node >=22`.
- [Strands harness | Strands Agents](https://strandsagents.com/docs/user-guide/harness/) and [Introducing Strands harness](https://strandsagents.com/blog/introducing-strands-harness/) — official docs (not reachable from the investigation environment; listed for follow-up).
- [MarkTechPost, 21 Sep 2026](https://www.marktechpost.com/2026/09/21/aws-strands-agents-team-releases-strands-harness/) and [thelettertwo.com](https://thelettertwo.com/2026/09/21/aws-strands-harness) — release coverage, Apache 2.0, Python and TypeScript.
- [Electron v33.3.1 `DEPS`](https://github.com/electron/electron/blob/v33.3.1/DEPS) — `node_version: v20.18.1`.
- Package internals quoted above were read from the extracted npm tarballs: `dist/src/agent.d.ts`, `dist/src/defaults.d.ts`, `dist/src/tools/file-tools.js`, `dist/src/plugins/environment.js` (harness) and `dist/src/agent/agent.d.ts`, `dist/src/sandbox/not-a-sandbox-local-environment.js`, `dist/src/vended-interventions/hitl/hitl.d.ts`, `dist/src/interventions/*.d.ts`, `dist/src/hooks/events.d.ts`, `dist/src/session/session-manager.d.ts`, `dist/src/vended-plugins/skills/*.d.ts` (SDK).
