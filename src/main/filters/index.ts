/**
 * Filter registry — matches commands to their output filters.
 * This is the main entry point for the filter engine.
 */

import { filterGitStatus, filterGitLog, filterGitDiff, filterGitPush, filterGitBranch } from './git.js';
import { filterTestOutput } from './test-runners.js';
import { filterTscOutput, filterLintOutput } from './build.js';
import { filterLsOutput, filterFindOutput } from './filesystem.js';
import { stripAnsi, deduplicateLines, truncateOutput } from './generic.js';

export type FilterFn = (stdout: string, stderr: string, exitCode: number) => string;

export interface FilterRule {
  /** Unique name for this filter */
  name: string;
  /** Regex to match against the command string */
  pattern: RegExp;
  /** The filter function to apply */
  filter: FilterFn;
  /** Human-readable description */
  description: string;
}

/**
 * Wrap a stdout-only filter function to handle stderr fallback on failure.
 * If the command failed (non-zero exit) and stdout is empty, return stderr.
 */
function wrapFilter(fn: (stdout: string) => string): FilterFn {
  return (stdout: string, stderr: string, exitCode: number): string => {
    if (exitCode !== 0 && !stdout.trim() && stderr.trim()) {
      return stripAnsi(stderr).trim();
    }
    // On failure with stdout, prepend stderr if present
    const filtered = fn(stdout);
    if (exitCode !== 0 && stderr.trim()) {
      return `${stripAnsi(stderr).trim()}\n\n${filtered}`;
    }
    return filtered;
  };
}

/** All registered filter rules, checked in order. */
const FILTER_RULES: FilterRule[] = [
  // Git commands
  {
    name: 'git-status',
    pattern: /^git\s+status\b/,
    filter: wrapFilter(filterGitStatus),
    description: 'Compress git status to summary + file list',
  },
  {
    name: 'git-log',
    pattern: /^git\s+log\b/,
    filter: wrapFilter(filterGitLog),
    description: 'Compact git log to hash + subject',
  },
  {
    name: 'git-diff',
    pattern: /^git\s+diff\b/,
    filter: wrapFilter(filterGitDiff),
    description: 'Truncate long diffs',
  },
  {
    name: 'git-push',
    pattern: /^git\s+(push|pull|fetch)\b/,
    filter: wrapFilter(filterGitPush),
    description: 'Extract push/pull/fetch summary',
  },
  {
    name: 'git-branch',
    pattern: /^git\s+branch\b/,
    filter: wrapFilter(filterGitBranch),
    description: 'Clean branch listing',
  },

  // Test runners
  {
    name: 'test-runner',
    pattern: /(?:^|\s)(vitest|jest|pytest|npm\s+test|npx\s+(vitest|jest))\b/,
    filter: wrapFilter(filterTestOutput),
    description: 'Extract test failures + summary',
  },

  // Build tools
  {
    name: 'tsc',
    pattern: /(?:^|\s)(tsc|npx\s+tsc)\b/,
    filter: wrapFilter(filterTscOutput),
    description: 'Extract TypeScript errors',
  },
  {
    name: 'lint',
    pattern: /(?:^|\s)(eslint|npx\s+eslint|prettier)\b/,
    filter: wrapFilter(filterLintOutput),
    description: 'Group lint issues by rule',
  },

  // Filesystem
  {
    name: 'ls',
    pattern: /^ls\b/,
    filter: wrapFilter(filterLsOutput),
    description: 'Compact directory listings',
  },
  {
    name: 'find',
    pattern: /^find\b/,
    filter: wrapFilter(filterFindOutput),
    description: 'Truncate find results',
  },
];

/**
 * Find a matching filter rule for a command string.
 * Returns null if no filter matches.
 */
export function matchFilter(command: string): FilterRule | null {
  const trimmed = command.trim();
  for (const rule of FILTER_RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule;
    }
  }
  return null;
}

/**
 * Apply a filter rule to command output.
 * Falls back to generic truncation if the filter throws.
 */
export function applyFilter(rule: FilterRule, stdout: string, stderr: string, exitCode: number): string {
  try {
    const result = rule.filter(stdout, stderr, exitCode);
    return deduplicateLines(result);
  } catch {
    // Graceful fallback: return truncated raw output
    const raw = stdout || stderr;
    return truncateOutput(stripAnsi(raw), 3000);
  }
}

// Re-export generic utilities for use by standalone runner
export { stripAnsi, deduplicateLines, truncateOutput } from './generic.js';
