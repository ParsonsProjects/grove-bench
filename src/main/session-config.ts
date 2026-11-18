/**
 * How a conversation's agent is configured: starting mode and controls, the
 * system prompt Grove adds, model ids, and the read-safe sandbox.
 */
import path from 'node:path';
import type { AgentEvent, PermissionMode } from '../shared/types.js';
import { CONTROL_IDS } from '../shared/types.js';
import type { AgentAdapter } from './adapters/types.js';
import * as memory from './memory.js';
import { getCavemanPrompt } from './caveman.js';

/**
 * Sandbox settings for Read-safe-mode queries: OS-level enforcement layered
 * under the read-only classifier (see read-only-tools.ts). Writes are confined
 * to the worktree, Bash approval stays with the classifier (no blanket
 * auto-allow), and the model cannot opt commands out of the sandbox. Degrades
 * gracefully — with a warning, running unsandboxed — on machines where
 * sandbox dependencies are unavailable; the classifier remains the approval
 * gate either way.
 *
 * The provider's native 'auto' mode gets no Grove-imposed sandbox: its
 * classifier is the approval layer, and any sandbox the user configured in
 * their own Claude settings still applies.
 */
export function readSafeSandbox(worktreePaths: readonly string[]): Record<string, unknown> {
  return {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    // The thread's worktree, and its linked projects' worktrees.
    filesystem: { allowWrite: [...worktreePaths] },
  };
}

/** Shown the first time a conversation runs in read-safe mode. The sandbox
 *  is requested with failIfUnavailable: false, so where it can't start the
 *  agent's commands run unsandboxed (the SDK only logs a warning). */
export const READ_SAFE_SANDBOX_WARNING =
  'Read-safe mode asks for an OS sandbox, but runs without one if it can\'t start on this machine ' +
  '(on Windows the sandbox has to be set up first). Without it, commands the read-only check lets ' +
  'through run unsandboxed, so treat that check as a convenience, not protection.';

/** Shown instead for agents Grove can't give a sandbox (capabilities.sandbox
 *  is false, as for every ACP agent). */
export const READ_SAFE_NO_SANDBOX_WARNING =
  'Read-safe mode has no OS sandbox with this agent: commands the read-only check lets through run ' +
  'without one, so treat that check as a convenience, not protection.';

/** The read-safe warning that is true for this agent. */
export function readSafeWarning(hasSandbox: boolean): string {
  return hasSandbox ? READ_SAFE_SANDBOX_WARNING : READ_SAFE_NO_SANDBOX_WARNING;
}

/** Whether a conversation has already shown a read-safe sandbox warning. */
export function hasSandboxWarning(history: readonly AgentEvent[]): boolean {
  return history.some((e) => e.type === 'status'
    && (e.message === READ_SAFE_SANDBOX_WARNING || e.message === READ_SAFE_NO_SANDBOX_WARNING));
}

/**
 * The permission mode a new conversation starts in: the one asked for, else
 * the saved default for this agent, else 'default'. One the adapter does not
 * offer on this model (e.g. native auto mode on Haiku) falls back to the
 * adapter's default mode.
 */
export function startingPermissionMode(
  adapter: Pick<AgentAdapter, 'getControls'>,
  model: string | null,
  requested: string | undefined,
  savedDefault: string | undefined,
): PermissionMode {
  const descriptor = adapter.getControls(model).find((d) => d.id === CONTROL_IDS.permissionMode);
  const mode = requested || savedDefault || 'default';
  return (descriptor && !descriptor.options.some((o) => o.value === mode)
    ? descriptor.default
    : mode) as PermissionMode;
}

/**
 * Initial control values for a new session: each of the adapter's declared
 * controls (except permissionMode, which has its own session field) starts
 * at the descriptor default, overlaid with the user's saved default for that
 * adapter, then with the value chosen for this conversation. Each layer only
 * applies when the descriptor offers that value, so an unoffered choice
 * falls back to the saved default rather than past it.
 */
export function initialControls(
  adapter: Pick<AgentAdapter, 'getControls'>,
  model: string | null,
  adapterDefaults: Record<string, string> | undefined,
  chosen?: Record<string, string> | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const d of adapter.getControls(model)) {
    if (d.id === CONTROL_IDS.permissionMode) continue;
    const offered = (v: string | undefined): v is string => !!v && d.options.some((o) => o.value === v);
    values[d.id] = d.default;
    const saved = adapterDefaults?.[d.id];
    if (offered(saved)) values[d.id] = saved;
    const pick = chosen?.[d.id];
    if (offered(pick)) values[d.id] = pick;
  }
  return values;
}

/**
 * Normalise a provider-reported model string back to a known picker id.
 * The SDK reports resolved/dated aliases (e.g. "claude-opus-4-8-20260101");
 * we map those back to the short id the picker and settings use. Returns
 * null when unrecognised so callers can keep the existing value.
 */
export function normalizeModelId(raw: string | undefined, adapter: Pick<AgentAdapter, 'getModels'>): string | null {
  if (!raw) return null;
  const models = adapter.getModels();
  const exact = models.find((m) => m.id === raw);
  if (exact) return exact.id;
  // Longest prefix wins: "claude-opus-5-5-<date>" also starts with
  // "claude-opus-5", so list order alone can't be trusted here.
  const prefixed = models
    .filter((m) => raw.startsWith(m.id))
    .sort((a, b) => b.id.length - a.id.length)[0];
  return prefixed?.id ?? null;
}

/**
 * The text Grove appends to the agent's system prompt: path rules, project
 * memory, caveman mode and the user's own addition, in that order. Null when
 * there is nothing to add.
 */
export function appendedSystemPrompt(opts: {
  cwd: string;
  repoPath: string;
  userAppend: string | null;
  cavemanMode: Parameters<typeof getCavemanPrompt>[0];
  /** The thread's linked projects (docs/linked-projects-plan.md). */
  linked?: readonly LinkedProjectNote[];
}): string | null {
  const others = (opts.linked?.length ?? 0) > 0;
  const builtInPrompt = [
    'IMPORTANT PATH RULES — you are already in your project directory. Follow these strictly:',
    // Every agent gets these, so they name no agent's tools.
    '- Use RELATIVE paths (e.g. "src/foo.ts") for ALL file operations: reading, editing, writing and searching files. NEVER use absolute paths like "' + opts.cwd.replace(/\\/g, '/').slice(0, 30) + '...". Just use paths relative to the project root.'
      + (others ? ' Files in the other projects listed below are the exception: use absolute paths there.' : ''),
    '- Files the user attaches to a message are the one exception: they are saved outside the project, so open them by the absolute path given.',
    '- When running shell commands, use short command names (npm, npx, node, git) not absolute paths to binaries.',
    '- Do NOT use `cd` to navigate to your current working directory before running commands — you are already there.',
    '- If you see an absolute path in tool output or environment info, do NOT repeat it back in your tool calls. Convert it to a relative path from the project root.'
      + (others ? ' Paths in the other projects listed below stay absolute.' : ''),
  ].join('\n');
  const linkedPrompt = others ? linkedProjectsPrompt(opts.linked!) : null;
  const memoryPrompt = memory.getMemoryForSystemPrompt(opts.repoPath);
  const cavemanPrompt = getCavemanPrompt(opts.cavemanMode);
  return [builtInPrompt, linkedPrompt, memoryPrompt, cavemanPrompt, opts.userAppend].filter(Boolean).join('\n\n') || null;
}

/** A linked project as the agent is told about it. */
export interface LinkedProjectNote {
  /** The project's name (its folder's). */
  name: string;
  /** The thread's worktree of it, where the agent works. */
  path: string;
  /** The project's own folder, which the agent must leave alone. */
  repoPath: string;
  /** Instruction files in the worktree the agent should read itself, as
   *  names (AGENTS.md): those its agent doesn't load on its own. */
  instructions: string[];
}

/** The part of the prompt about the thread's linked projects: where each
 *  worktree is, that the project's own folder isn't to be edited, and which
 *  instruction files to read there. */
export function linkedProjectsPrompt(links: readonly LinkedProjectNote[]): string {
  return [
    'OTHER PROJECTS: this thread also works in these projects. Each is a git worktree made for this thread, on the same branch name as this project:',
    ...links.map((l) => `- ${l.name}: ${l.path} (the project's own folder, ${l.repoPath}, is not yours to edit)`),
    '- Make every change to these projects in their worktree above, never in the project\'s own folder. Use absolute paths inside the worktree.',
    '- Run git for one of them with `git -C "<its worktree>"`, so it works on that worktree\'s branch.',
    ...links.flatMap((l) => l.instructions.map((file) => `- Before working in ${l.name}, read ${path.join(l.path, file)}: it says how to work in that project.`)),
  ].join('\n');
}
