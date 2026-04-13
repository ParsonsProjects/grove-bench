/**
 * Test runner output filters.
 * Extract failures + summary, strip passing test details.
 */

import { stripAnsi } from './generic.js';

/**
 * Filter test output from vitest, jest, or similar runners.
 * Keeps: failure details, error messages, stack traces, summary line.
 * Removes: passing test listings, progress indicators, timing for passing tests.
 */
export function filterTestOutput(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  const lines = text.split('\n');
  const failures: string[] = [];
  const summaryLines: string[] = [];
  let inFailure = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect summary lines (vitest / jest style)
    if (trimmed.match(/^(Test Files?|Tests?|Test Suites?)\s+/i) ||
        trimmed.match(/^(Duration|Time)\s+/i)) {
      summaryLines.push(trimmed);
      inFailure = false;
      continue;
    }

    // Detect failure start markers
    if (trimmed.startsWith('FAIL ') ||
        trimmed.match(/✗|✕|×|FAIL/) ||
        trimmed.match(/^\s*●\s/)) {
      inFailure = true;
      failures.push(line);
      continue;
    }

    // Detect passing file lines (skip them)
    if (trimmed.startsWith('PASS ') ||
        trimmed.match(/✓|✔/) ||
        trimmed.match(/^\s*✓\s/)) {
      inFailure = false;
      continue;
    }

    // If we're in a failure block, keep the line (error details, stack trace)
    if (inFailure) {
      // Empty line might end the failure block, but keep it if next line is indented
      if (!trimmed && i + 1 < lines.length && !lines[i + 1].match(/^\s{2,}/)) {
        inFailure = false;
      } else {
        failures.push(line);
      }
      continue;
    }
  }

  const parts: string[] = [];

  if (failures.length > 0) {
    parts.push(failures.join('\n'));
  }

  if (summaryLines.length > 0) {
    parts.push(summaryLines.join('\n'));
  }

  // If we found no structure, it might be an unfamiliar format — return truncated
  if (parts.length === 0) {
    // Return last 20 lines as likely summary
    return lines.slice(-20).join('\n');
  }

  return parts.join('\n\n');
}
