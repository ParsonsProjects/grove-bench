/**
 * Pure utility functions shared between agent-session.ts and adapters.
 */

import path from 'node:path';
import { TOOL_RULE_KEYWORDS } from '../shared/types.js';
import type { ToolCategory, ToolRule } from '../shared/types.js';

/**
 * True if `child` resolves to a location inside (or equal to) `parent`.
 * Uses path.relative rather than string-prefix matching, so "/repo/src-secret"
 * is correctly treated as OUTSIDE "/repo/src". path.relative on win32 compares
 * case-insensitively and returns an absolute path across drives, both of which
 * this handles.
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * Environment variable prefixes that leak noisy paths into the LLM context.
 */
export const ENV_NOISE_PREFIXES = ['npm_', 'NVM_', 'FNM_', 'VSCODE_', 'ELECTRON_'];

/**
 * Strip noisy env vars that leak absolute paths into the LLM context,
 * causing the model to use full paths for simple CLI commands.
 */
export function cleanEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !ENV_NOISE_PREFIXES.some(p => key.startsWith(p))
    )
  );
}

/** Split `Tool(spec)` / `Tool` into its parts; null when malformed. */
export function parseToolRule(pattern: string): { tool: string; specifier: string | null } | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('(')) return { tool: trimmed, specifier: null };
  const match = trimmed.match(/^([^(]+)\((.*)\)$/s);
  if (!match) return null;
  return { tool: match[1].trim(), specifier: match[2] };
}

function globToRegExp(glob: string): RegExp | null {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 's');
  } catch {
    return null;
  }
}

/**
 * The part of a tool call a rule's glob is matched against, in neutral
 * terms: the command for shell tools, the target path for edit/read tools,
 * the URL for web fetches, the prompt for sub-agents. Adapters call this so
 * the same rule text works whatever the provider names its fields.
 */
export function toolCallSpecifier(
  toolName: string,
  input: Record<string, unknown> | null | undefined,
  category?: ToolCategory,
): string {
  const str = (key: string): string | null => {
    const v = input?.[key];
    return typeof v === 'string' && v ? v : null;
  };
  switch (category) {
    case 'bash': return str('command') ?? '';
    case 'edit':
    case 'read': return str('file_path') ?? str('notebook_path') ?? str('path') ?? str('pattern') ?? '';
    case 'web_fetch': return str('url') ?? '';
    case 'agent': return str('prompt') ?? str('description') ?? '';
    default:
      // Unknown category: fall back to the most common fields so provider-
      // named rules like Bash(...) keep working for tools we don't classify.
      return str('command') ?? str('file_path') ?? str('url') ?? '';
  }
}

/** True when a parsed rule's `<tool>` part covers this tool, ignoring its glob. */
function ruleTargetsTool(rule: { tool: string }, toolName: string, category?: ToolCategory): boolean {
  const keyword = rule.tool.toLowerCase();
  if (keyword === 'mcp') return toolName.startsWith('mcp__');
  const neutralCategory = TOOL_RULE_KEYWORDS[keyword];
  return (neutralCategory !== undefined && category !== undefined && neutralCategory === category)
    || toolName === rule.tool
    || toolName.startsWith(rule.tool);
}

/** A rule with no glob, or `(*)`, covers every call to its tool. */
function isToolWideRule(rule: { specifier: string | null }): boolean {
  return rule.specifier === null || rule.specifier === '*';
}

/**
 * Match a tool rule pattern against a tool call.
 *
 * `pattern` is `<tool>` or `<tool>(<glob>)` where `<tool>` is a neutral
 * keyword (see TOOL_RULE_KEYWORDS: `shell`, `edit`, `read`, `web`, `agent`,
 * `question`, or `mcp` for any `mcp__*` tool) matched via `category`, or a
 * provider tool name matched by exact name / prefix. `toolCall` is
 * `Name(specifier)` (or just `Name`); the glob matches the specifier, except
 * for `mcp(...)` where it matches the tool name after `mcp__`.
 *
 * This matches the whole specifier as one string. To decide whether a call
 * is allowed or denied, use checkToolRules, which splits chained shell
 * commands first.
 */
export function matchToolRule(pattern: string, toolName: string, toolCall: string, category?: ToolCategory): boolean {
  const rule = parseToolRule(pattern);
  if (!rule) return false;
  const isMcpKeyword = rule.tool.toLowerCase() === 'mcp';
  if (!ruleTargetsTool(rule, toolName, category)) return false;

  if (rule.specifier === null) return true;
  if (rule.specifier === '*') return true;

  const subject = isMcpKeyword
    ? toolName.slice('mcp__'.length)
    : (toolCall.startsWith(toolName + '(') && toolCall.endsWith(')')
      ? toolCall.slice(toolName.length + 1, -1)
      : '');
  const re = globToRegExp(rule.specifier);
  return re ? re.test(subject) : false;
}

/** Operators that need a command on their right-hand side. */
const BINARY_SHELL_OPERATORS = new Set(['&&', '||', '|', '|&']);

/**
 * Split a shell command into the commands it chains, on the separators
 * Claude Code's own permission rules split on: `&&`, `||`, `;`, `|`, `|&`,
 * `&` and newlines. Quotes and backslash escapes are respected, so
 * `git commit -m "a; b"` is one command, and redirects such as `2>&1`,
 * `&>` and `>|` are not separators.
 *
 * Returns null when the command can't be split with confidence: command or
 * process substitution, backticks, `${...}`, parentheses outside quotes,
 * here-docs (their bodies aren't shell syntax), comments, unbalanced quotes,
 * or an operator with nothing around it (`npm test &&`, `; ls`). Callers
 * must treat null as "no allow rule matches".
 */
export function splitShellCommand(command: string): string[] | null {
  // Substitutions, plus ${...} and $[...] whose insides bash parses with
  // its own quoting rules. Rejected even inside single quotes, where they'd
  // be harmless: simpler to fail closed than to track where they are live.
  if (/`|\$[({[]/.test(command)) return null;

  const parts: { text: string; op: string | null }[] = [];
  let current = '';
  let quote: "'" | '"' | "$'" | null = null;
  const endPart = (op: string | null) => {
    parts.push({ text: current, op });
    current = '';
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];

    if (quote) {
      current += c;
      // Backslash escapes work in "..." and $'...', never in '...'.
      if (c === '\\' && quote !== "'" && next !== undefined) {
        current += next;
        i++;
      } else if (c === (quote === '"' ? '"' : "'")) {
        quote = null;
      }
      continue;
    }

    if (c === '\\') {
      current += c + (next ?? '');
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
      continue;
    }
    // Like bash's tokenizer, read $$ as one token first, so the ' in $$'
    // opens a plain quote and not a $'...' one.
    if (c === '$' && (next === '$' || next === "'")) {
      if (next === "'") quote = "$'";
      current += c + next;
      i++;
      continue;
    }
    // Subshells, process substitution, $((...)), function bodies.
    if (c === '(' || c === ')') return null;
    // A # that starts a word begins a comment, which could hide a quote the
    // shell ignores but we'd count. Mid-word (a#b) it's a literal.
    if (c === '#' && (current === '' || /[\s<>&|;]$/.test(current))) return null;
    if (c === '<' && next === '<') {
      if (command[i + 2] !== '<') return null; // here-doc
      current += '<<<'; // here-string: a single word
      i += 2;
      continue;
    }
    if (c === '>' || c === '<') {
      // >&, <& and >| are redirects, not separators.
      current += c;
      if (next === '&' || (c === '>' && next === '|')) {
        current += next;
        i++;
      }
      continue;
    }
    if (c === '&') {
      if (next === '&') { endPart('&&'); i++; }
      else if (next === '>') { current += '&>'; i++; } // &> and &>> redirect
      else endPart('&');
      continue;
    }
    if (c === '|') {
      if (next === '|' || next === '&') { endPart(c + next); i++; }
      else endPart('|');
      continue;
    }
    if (c === ';' || c === '\n') {
      endPart(c);
      continue;
    }
    current += c;
  }
  if (quote) return null;
  endPart(null);

  const commands: string[] = [];
  let needsCommand = false;
  for (const { text, op } of parts) {
    const cmd = text.trim();
    if (!cmd) {
      // Blank lines are fine, and the shell reads on past a line ending in
      // && or |. So is nothing after a final ; or &.
      if (op === '\n') continue;
      if (op === null && commands.length > 0 && !needsCommand) continue;
      return null;
    }
    commands.push(cmd);
    needsCommand = op !== null && BINARY_SHELL_OPERATORS.has(op);
  }
  return commands.length > 0 ? commands : null;
}

/**
 * Check a tool call against the settings' allow and deny rules. Deny wins.
 *
 * Shell commands follow Claude Code's own permission rules: a chain such as
 * `npm run build && rm -rf ~` is split first, a deny rule applies when it
 * matches the whole command or any command in it, and allow rules approve
 * only when every command in it matches one of them. When the command can't
 * be split safely (see splitShellCommand), only a rule covering every shell
 * call (`shell` or `shell(*)`) approves it, and only when no deny rule has a
 * glob for shell, because we can't see which commands a deny rule might hit.
 *
 * Returns null when no rule decides, so the call falls through to the normal
 * permission prompt.
 */
export function checkToolRules(
  allowRules: readonly ToolRule[],
  denyRules: readonly ToolRule[],
  toolName: string,
  specifier: string,
  category?: ToolCategory,
): { behavior: 'deny'; pattern: string } | { behavior: 'allow' } | null {
  const matches = (rule: ToolRule, subject: string) =>
    matchToolRule(rule.pattern, toolName, subject ? `${toolName}(${subject})` : toolName, category);

  if (category !== 'bash') {
    const denied = denyRules.find((rule) => matches(rule, specifier));
    if (denied) return { behavior: 'deny', pattern: denied.pattern };
    return allowRules.some((rule) => matches(rule, specifier)) ? { behavior: 'allow' } : null;
  }

  const commands = splitShellCommand(specifier);
  const denied = denyRules.find(
    (rule) => matches(rule, specifier) || (commands?.some((cmd) => matches(rule, cmd)) ?? false),
  );
  if (denied) return { behavior: 'deny', pattern: denied.pattern };

  if (commands) {
    const allowed = commands.every((cmd) => allowRules.some((rule) => matches(rule, cmd)));
    return allowed ? { behavior: 'allow' } : null;
  }

  const rulesForTool = (rules: readonly ToolRule[]) =>
    rules.flatMap((rule) => {
      const parsed = parseToolRule(rule.pattern);
      return parsed && ruleTargetsTool(parsed, toolName, category) ? [parsed] : [];
    });
  const allowsAnyCommand = rulesForTool(allowRules).some(isToolWideRule);
  // Tool-wide deny rules already matched above, so any left here have a glob.
  const denyMightApply = rulesForTool(denyRules).length > 0;
  return allowsAnyCommand && !denyMightApply ? { behavior: 'allow' } : null;
}

/**
 * Creates an AsyncIterable from a ReadableStream so we can pass
 * it to query()'s prompt parameter for multi-turn conversations.
 */
export function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const reader = stream.getReader();
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined as any };
          return { done: false, value };
        },
        async return() {
          reader.releaseLock();
          return { done: true, value: undefined as any };
        },
        async throw(e: unknown) {
          reader.cancel(e instanceof Error ? e.message : String(e));
          return { done: true, value: undefined as any };
        },
      };
    },
  };
}

/**
 * Find the provider chain-entry UUID to fork at when rewinding to the user
 * message with the given (Grove-generated) uuid: the SDK uuid of the last
 * assistant-side event before that message in the event history. Returns null
 * when the target isn't found or no provider content precedes it (e.g. a
 * rewind to the first message), in which case the caller should fall back to
 * starting a fresh conversation.
 *
 * Only assistant-side events carry provider uuids — user_message events hold
 * Grove's own uuids and must not be used as fork points.
 */
export function findRewindForkPoint(
  events: import('../shared/types.js').AgentEvent[],
  targetUuid: string,
): string | null {
  const idx = events.findLastIndex(
    (e) => e.type === 'user_message' && e.uuid === targetUuid,
  );
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const e = events[i];
    if (
      (e.type === 'assistant_text' || e.type === 'assistant_tool_use' || e.type === 'thinking') &&
      e.uuid
    ) {
      return e.uuid;
    }
  }
  return null;
}
