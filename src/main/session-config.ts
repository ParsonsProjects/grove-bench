/**
 * How a conversation's agent is configured: starting mode and controls, the
 * system prompt Grove adds, model ids, and the read-safe sandbox.
 */
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
export function readSafeSandbox(worktreePath: string): Record<string, unknown> {
  return {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    filesystem: { allowWrite: [worktreePath] },
  };
}

/** Shown the first time a conversation runs in read-safe mode. The sandbox
 *  is requested with failIfUnavailable: false, so where it can't start the
 *  agent's commands run unsandboxed (the SDK only logs a warning). */
export const READ_SAFE_SANDBOX_WARNING =
  'Read-safe mode asks for an OS sandbox, but runs without one if it can\'t start on this machine ' +
  '(on Windows the sandbox has to be set up first). Without it, commands the read-only check lets ' +
  'through run unsandboxed, so treat that check as a convenience, not protection.';

/** Whether a conversation has already shown READ_SAFE_SANDBOX_WARNING. */
export function hasSandboxWarning(history: readonly AgentEvent[]): boolean {
  return history.some((e) => e.type === 'status' && e.message === READ_SAFE_SANDBOX_WARNING);
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
}): string | null {
  const builtInPrompt = [
    'IMPORTANT PATH RULES — you are already in your project directory. Follow these strictly:',
    '- Use RELATIVE paths (e.g. "src/foo.ts") for ALL file operations: Read, Edit, Write, Grep, Glob. NEVER use absolute paths like "' + opts.cwd.replace(/\\/g, '/').slice(0, 30) + '..." — just use paths relative to the project root.',
    '- When running Bash commands, use short command names (npm, npx, node, git) not absolute paths to binaries.',
    '- Do NOT use `cd` to navigate to your current working directory before running commands — you are already there.',
    '- If you see an absolute path in tool output or environment info, do NOT repeat it back in your tool calls. Convert it to a relative path from the project root.',
  ].join('\n');
  const memoryPrompt = memory.getMemoryForSystemPrompt(opts.repoPath);
  const cavemanPrompt = getCavemanPrompt(opts.cavemanMode);
  return [builtInPrompt, memoryPrompt, cavemanPrompt, opts.userAppend].filter(Boolean).join('\n\n') || null;
}
