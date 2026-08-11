#!/usr/bin/env node
/**
 * Grove Bench — Claude Code PreToolUse Hook Handler
 *
 * Reads hook input from stdin, checks if the Bash command is filterable,
 * and rewrites it to go through grove-filter.js if so.
 *
 * Exit codes:
 *   0 — success (JSON output processed by Claude Code)
 *   Non-zero — passthrough (no rewrite)
 *
 * Environment:
 *   GROVE_FILTER_SCRIPT — absolute path to grove-filter.js
 */

'use strict';

const path = require('path');

// ─── Filter Registry (matches same patterns as grove-filter.js) ───

const FILTERABLE_PATTERNS = [
  /^git\s+status\b/,
  /^git\s+log\b/,
  /^git\s+diff\b/,
  /^git\s+(push|pull|fetch)\b/,
  /^git\s+branch\b/,
  /(?:^|\s)(vitest|jest|pytest|npm\s+test|npx\s+(vitest|jest))\b/,
  /(?:^|\s)(tsc|npx\s+tsc)\b/,
  /(?:^|\s)(eslint|npx\s+eslint|prettier)\b/,
  /^ls\b/,
  /^find\b/,
];

function isFilterable(command) {
  const trimmed = command.trim();
  return FILTERABLE_PATTERNS.some(p => p.test(trimmed));
}

// ─── Main ───

function main() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(input);
      const toolInput = payload.tool_input || {};
      const command = toolInput.command;

      if (!command || typeof command !== 'string') {
        // No command to rewrite — passthrough
        process.exit(0);
        return;
      }

      if (!isFilterable(command)) {
        // Not a filterable command — passthrough
        process.exit(0);
        return;
      }

      // Determine path to grove-filter.js
      const filterScript = process.env.GROVE_FILTER_SCRIPT ||
        path.join(__dirname, 'grove-filter.js');

      // Rewrite the command to go through the filter
      const rewrittenCommand = `node "${filterScript}" ${command}`;

      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            command: rewrittenCommand,
          },
        },
      };

      process.stdout.write(JSON.stringify(output));
    } catch {
      // Parse error or unexpected input — passthrough
      process.exit(0);
    }
  });
}

main();
