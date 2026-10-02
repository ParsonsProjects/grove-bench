/**
 * Reading tool allow/deny rules (see ToolRule), shared by the main process,
 * which matches them, and Settings, which checks them as they are typed.
 */

import { TOOL_RULE_KEYWORDS } from './types.js';

/** Split `Tool(spec)` / `Tool` into its parts; null when malformed. */
export function parseToolRule(pattern: string): { tool: string; specifier: string | null } | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('(')) return { tool: trimmed, specifier: null };
  const match = trimmed.match(/^([^(]+)\((.*)\)$/s);
  if (!match) return null;
  return { tool: match[1].trim(), specifier: match[2] };
}

const KEYWORDS = [...Object.keys(TOOL_RULE_KEYWORDS), 'mcp'];

/** What Settings says about a typed rule. An `error` is a rule that can never
 *  match anything, so it isn't added. A `hint` is a rule that looks like a
 *  slip but could be meant, such as a provider's own tool name. */
export function checkToolRulePattern(pattern: string): { error: string } | { hint: string } | null {
  const trimmed = pattern.trim();
  const rule = parseToolRule(trimmed);
  if (!rule) {
    const unclosed = trimmed.split('(').length > trimmed.split(')').length && parseToolRule(`${trimmed})`);
    return {
      error: unclosed
        ? `The bracket isn't closed, so this would never match. Did you mean ${trimmed})?`
        : 'Not a rule, so this would never match. Write a tool, or a tool and a pattern in brackets, e.g. shell(npm run *).',
    };
  }
  if (rule.specifier === null && /\s/.test(rule.tool)) {
    const [tool, ...rest] = rule.tool.split(/\s+/);
    return { hint: `With no brackets, all of this is read as a tool name. For a command, write ${tool}(${rest.join(' ')}).` };
  }
  if (Object.hasOwn(TOOL_RULE_KEYWORDS, rule.tool.toLowerCase()) || rule.tool.toLowerCase() === 'mcp') return null;
  if (/^[a-z]+$/.test(rule.tool)) {
    return { hint: `"${rule.tool}" isn't a rule keyword (${KEYWORDS.join(', ')}), so it only matches a tool whose own name starts with it.` };
  }
  return null;
}
