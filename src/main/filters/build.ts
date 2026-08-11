/**
 * Build tool and linter output filters.
 * Extract errors/warnings, strip progress noise.
 */

import { stripAnsi } from './generic.js';

/** Filter TypeScript compiler output to errors + count. */
export function filterTscOutput(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return 'ok';

  const lines = text.split('\n');
  const errors: string[] = [];
  const summary: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Error/warning lines: "file(line,col): error TSxxxx: message" or just "error TSxxxx:"
    if (trimmed.match(/(error|warning)\s+TS\d+/)) {
      errors.push(trimmed);
    }
    // Summary line: "Found N errors."
    if (trimmed.match(/^Found \d+ error/)) {
      summary.push(trimmed);
    }
  }

  if (errors.length === 0 && summary.length === 0) return 'ok';

  const parts: string[] = [];
  if (errors.length > 0) parts.push(errors.join('\n'));
  if (summary.length > 0) parts.push(summary.join('\n'));
  return parts.join('\n\n');
}

/** Filter ESLint/Prettier output to grouped rules + summary. */
export function filterLintOutput(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return 'ok';

  const lines = text.split('\n');
  const issueLines: string[] = [];
  const summaryLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Issue lines: "  10:5  error  message  rule-name"
    if (trimmed.match(/^\d+:\d+\s+(error|warning)\s+/)) {
      issueLines.push(trimmed);
    }
    // Summary: "✖ N problems"
    if (trimmed.match(/^\u2716|^\d+ problem/)) {
      summaryLines.push(trimmed);
    }
  }

  if (issueLines.length === 0 && summaryLines.length === 0) return 'ok';

  // Group by rule name and count
  const ruleGroups = new Map<string, number>();
  const ruleExamples = new Map<string, string>();
  for (const line of issueLines) {
    // Extract rule name (last non-empty segment)
    const parts = line.split(/\s{2,}/);
    const rule = parts[parts.length - 1] || 'unknown';
    ruleGroups.set(rule, (ruleGroups.get(rule) || 0) + 1);
    if (!ruleExamples.has(rule)) {
      ruleExamples.set(rule, line);
    }
  }

  const grouped = Array.from(ruleGroups.entries())
    .map(([rule, count]) => `  ${rule} (${count}x): ${ruleExamples.get(rule)}`)
    .join('\n');

  const parts: string[] = [];
  if (grouped) parts.push(grouped);
  if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
  return parts.join('\n\n');
}
