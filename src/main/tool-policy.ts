/**
 * What Grove decides about a tool call before the user is asked, the same way
 * for every agent. The Claude Code adapter runs it from the SDK's canUseTool,
 * the ACP adapter on each permission request (and to warn about calls the
 * agent made without asking). Anything left as 'ask' goes to the session's
 * permission handler (session-permissions.ts), where Read-safe mode can still
 * approve read-only calls.
 *
 * The order: the thread's allowed tools, the user's deny and allow rules,
 * reads of the files the user attached, Grove's own tools, then the agent's
 * own checks (`guard`, Claude's sandbox), "always allow", and edits inside the
 * worktree in Edit and Read-safe modes for agents whose edits Grove approves.
 */
import path from 'node:path';
import type { ToolCategory, ToolRule } from '../shared/types.js';
import type { ToolView } from '../shared/tool-view.js';
import { checkToolRules, isPathInside, type ShellSyntax } from './agent-utils.js';
import { isAutoAllowedGroveTool } from './adapters/grove-tools.js';

/** A tool call as the policy sees it. Each adapter builds it its own way. */
export interface PolicyCall {
  /** The name Grove keys the call by (allowed tools, always-allow, rules). */
  toolName: string;
  category: ToolCategory;
  view: ToolView;
  /** What a rule's glob is matched against: the command, path, URL, ... */
  specifier: string;
  /** Shells a command may be read as. A deny under any of them denies; an
   *  allow needs all of them. Default: bash. */
  shells?: readonly ShellSyntax[];
}

export interface PolicyContext {
  cwd: string;
  /** The folder the user's attached files are saved in: reading there needs no prompt. */
  attachmentsDir?: string | null;
  /** The only tools this thread may use, when set. */
  allowedTools?: ReadonlySet<string> | null;
  toolAllowRules: readonly ToolRule[];
  toolDenyRules: readonly ToolRule[];
  /** Tools the user said to always allow in this thread. */
  alwaysAllowedTools: ReadonlySet<string>;
  /** Approve edits whose every path is inside `cwd`: Edit and Read-safe
   *  modes, for agents whose modes Grove applies itself (ACP). Claude Code
   *  applies its own. */
  approveEditsInWorktree?: boolean;
  /** The agent's own checks, run after the rules and before standing
   *  approvals, so "always allow" can't get past them (Claude's sandbox). */
  guard?: () => PolicyDecision | null;
}

export type PolicyDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string; reason: 'not-allowed' | 'rule' | 'guard' }
  | { behavior: 'ask' };

export function decideToolCall(call: PolicyCall, ctx: PolicyContext): PolicyDecision {
  if (ctx.allowedTools && !ctx.allowedTools.has(call.toolName)) {
    return { behavior: 'deny', reason: 'not-allowed', message: `Tool "${call.toolName}" is not allowed in this session` };
  }

  const rule = ruleVerdict(call, ctx);
  if (rule?.behavior === 'deny') return { behavior: 'deny', reason: 'rule', message: `Denied by settings rule: ${rule.pattern}` };
  if (rule?.behavior === 'allow') return { behavior: 'allow' };

  // The files the user attached are saved outside the checkout, and the
  // message gives the agent their paths: reading them needs no prompt.
  if (readsAttachedFiles(call.view, ctx.cwd, ctx.attachmentsDir)) return { behavior: 'allow' };

  if (isAutoAllowedGroveTool(call.toolName)) return { behavior: 'allow' };

  const guarded = ctx.guard?.();
  if (guarded) return guarded;

  if (ctx.alwaysAllowedTools.has(call.toolName)) return { behavior: 'allow' };

  if (ctx.approveEditsInWorktree && call.category === 'edit' && editsInsideWorktree(call.view, ctx.cwd)) {
    return { behavior: 'allow' };
  }
  return { behavior: 'ask' };
}

/** The user's rules. Chained shell commands are split first (checkToolRules),
 *  so an allow has to match every command in the chain. */
function ruleVerdict(call: PolicyCall, ctx: PolicyContext): { behavior: 'deny'; pattern: string } | { behavior: 'allow' } | null {
  const { toolAllowRules, toolDenyRules } = ctx;
  const check = (shell?: ShellSyntax) =>
    checkToolRules(toolAllowRules, toolDenyRules, call.toolName, call.specifier, call.category, shell);
  if (call.category !== 'bash') return check();
  const verdicts = (call.shells?.length ? call.shells : (['bash'] as const)).map((shell) => check(shell));
  const denied = verdicts.find((v) => v?.behavior === 'deny');
  if (denied) return denied;
  return verdicts.every((v) => v?.behavior === 'allow') ? { behavior: 'allow' } : null;
}

/** The paths a view names. */
function pathsOf(view: ToolView): string[] {
  return [view.path, ...(view.morePaths ?? [])].filter((p): p is string => typeof p === 'string' && p !== '');
}

/** Whether a call only reads, and only inside the attachments folder. Only
 *  reads: the folder isn't a working directory, so the saved copies can't be
 *  edited without asking. */
export function readsAttachedFiles(view: ToolView, cwd: string, attachmentsDir: string | null | undefined): boolean {
  if (!attachmentsDir || (view.kind !== 'read' && view.kind !== 'search')) return false;
  const paths = pathsOf(view);
  return paths.length > 0 && paths.every((p) => isPathInside(attachmentsDir, path.resolve(cwd, p)));
}

/** Whether every path an edit names is inside the worktree (none named: no). */
export function editsInsideWorktree(view: ToolView, cwd: string): boolean {
  const paths = pathsOf(view);
  return paths.length > 0 && paths.every((p) => isPathInside(cwd, path.resolve(cwd, p)));
}
