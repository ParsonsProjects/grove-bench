#!/usr/bin/env node
/**
 * Grove Bench Command Output Filter — Standalone Runner
 *
 * Executes a shell command and filters its output to reduce token consumption.
 * Self-contained: no external dependencies, no Electron imports.
 *
 * Usage: node grove-filter.js <command> [args...]
 * Exit code: mirrors the original command's exit code.
 */

'use strict';

const { execSync } = require('child_process');

// ─── ANSI Stripping ───

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07/g;
function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

// ─── Generic Utilities ───

function deduplicateLines(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    result.push(lines[i]);
    let count = 0;
    while (i + 1 + count < lines.length && lines[i + 1 + count] === lines[i]) count++;
    if (count >= 2) {
      result.push(`... repeated ${count} more time${count === 1 ? '' : 's'}`);
      i += count + 1;
    } else {
      i++;
    }
  }
  return result.join('\n');
}

function truncateOutput(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const lines = text.split('\n');
  const tailCount = 5;
  const tail = lines.slice(-tailCount);
  const headLines = [];
  let charCount = 0;
  for (const line of lines) {
    if (charCount + line.length + 1 > maxChars * 0.7) break;
    headLines.push(line);
    charCount += line.length + 1;
  }
  const omitted = lines.length - headLines.length - tailCount;
  if (omitted <= 0) {
    return headLines.join('\n') + `\n[... truncated ${lines.length - headLines.length} lines]`;
  }
  return [...headLines, `[... truncated ${omitted} lines]`, ...tail].join('\n');
}

// ─── Git Filters ───

function filterGitStatus(output) {
  const text = stripAnsi(output).trim();
  if (!text) return 'clean';
  const lines = text.split('\n').filter(l => l.trim());
  const counts = {};
  const files = [];
  for (const line of lines) {
    const m = line.match(/^(.{1,2})\s+(.+)$/);
    if (!m) continue;
    const code = m[1].trim();
    const file = m[2].trim();
    counts[code] = (counts[code] || 0) + 1;
    files.push(`  ${code} ${file}`);
  }
  const summary = Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(' | ');
  const maxFiles = 30;
  const fileList = files.length > maxFiles
    ? [...files.slice(0, maxFiles), `  ... and ${files.length - maxFiles} more`]
    : files;
  return `${summary}\n${fileList.join('\n')}`;
}

function filterGitLog(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  const lines = text.split('\n');
  const isOneline = !lines[0]?.startsWith('commit ');
  if (isOneline) {
    return lines.slice(0, 20).join('\n') +
      (lines.length > 20 ? `\n... ${lines.length - 20} more commits` : '');
  }
  const entries = [];
  for (const line of lines) {
    if (line.startsWith('commit ')) {
      entries.push(line.slice(7, 14));
    } else if (line.startsWith('    ') && entries.length > 0) {
      const idx = entries.length - 1;
      if (!entries[idx].includes(' ')) entries[idx] += ' ' + line.trim();
    }
  }
  const max = 20;
  const result = entries.slice(0, max);
  if (entries.length > max) result.push(`... ${entries.length - max} more commits`);
  return result.join('\n');
}

function filterGitDiff(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  return truncateOutput(text, 3000);
}

function filterGitPush(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  const lines = text.split('\n');
  const keep = lines.filter(line =>
    /^\s+\S+\.\.\S+\s+/.test(line) ||
    /^To |^From /.test(line) ||
    /error|fatal|reject|denied/i.test(line) ||
    /hint:/i.test(line) ||
    /->/.test(line) ||
    line.startsWith('Already up to date')
  );
  return keep.length > 0 ? keep.join('\n') : text;
}

function filterGitBranch(output) {
  return stripAnsi(output).trim();
}

// ─── Test Runner Filters ───

function filterTestOutput(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  const lines = text.split('\n');
  const failures = [];
  const summaryLines = [];
  let inFailure = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(Test Files?|Tests?|Test Suites?)\s+/i.test(trimmed) ||
        /^(Duration|Time)\s+/i.test(trimmed)) {
      summaryLines.push(trimmed);
      inFailure = false;
      continue;
    }
    if (trimmed.startsWith('FAIL ') || /✗|✕|×|FAIL/.test(trimmed) || /^\s*●\s/.test(trimmed)) {
      inFailure = true;
      failures.push(line);
      continue;
    }
    if (trimmed.startsWith('PASS ') || /✓|✔/.test(trimmed) || /^\s*✓\s/.test(trimmed)) {
      inFailure = false;
      continue;
    }
    if (inFailure) {
      if (!trimmed && i + 1 < lines.length && !/^\s{2,}/.test(lines[i + 1])) {
        inFailure = false;
      } else {
        failures.push(line);
      }
      continue;
    }
  }
  const parts = [];
  if (failures.length > 0) parts.push(failures.join('\n'));
  if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
  if (parts.length === 0) return lines.slice(-20).join('\n');
  return parts.join('\n\n');
}

// ─── Build Filters ───

function filterTscOutput(output) {
  const text = stripAnsi(output).trim();
  if (!text) return 'ok';
  const lines = text.split('\n');
  const errors = [];
  const summary = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/(error|warning)\s+TS\d+/.test(trimmed)) errors.push(trimmed);
    if (/^Found \d+ error/.test(trimmed)) summary.push(trimmed);
  }
  if (errors.length === 0 && summary.length === 0) return 'ok';
  const parts = [];
  if (errors.length > 0) parts.push(errors.join('\n'));
  if (summary.length > 0) parts.push(summary.join('\n'));
  return parts.join('\n\n');
}

function filterLintOutput(output) {
  const text = stripAnsi(output).trim();
  if (!text) return 'ok';
  const lines = text.split('\n');
  const issueLines = [];
  const summaryLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+:\d+\s+(error|warning)\s+/.test(trimmed)) issueLines.push(trimmed);
    if (/^\u2716|^\d+ problem/.test(trimmed)) summaryLines.push(trimmed);
  }
  if (issueLines.length === 0 && summaryLines.length === 0) return 'ok';
  const ruleGroups = new Map();
  const ruleExamples = new Map();
  for (const line of issueLines) {
    const parts = line.split(/\s{2,}/);
    const rule = parts[parts.length - 1] || 'unknown';
    ruleGroups.set(rule, (ruleGroups.get(rule) || 0) + 1);
    if (!ruleExamples.has(rule)) ruleExamples.set(rule, line);
  }
  const grouped = Array.from(ruleGroups.entries())
    .map(([rule, count]) => `  ${rule} (${count}x): ${ruleExamples.get(rule)}`)
    .join('\n');
  const parts = [];
  if (grouped) parts.push(grouped);
  if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
  return parts.join('\n\n');
}

// ─── Filesystem Filters ───

function filterLsOutput(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  const lines = text.split('\n');
  const isLongFormat = lines[0]?.startsWith('total ') || lines[0]?.match(/^[dlrwx-]{10}/);
  if (!isLongFormat) return text;
  const entries = [];
  for (const line of lines) {
    if (line.startsWith('total ')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const name = parts.slice(8).join(' ');
    if (name === '.' || name === '..') continue;
    const isDir = line.startsWith('d');
    const size = parts[4];
    entries.push(`${isDir ? 'd' : '-'} ${size.padStart(8)} ${name}`);
  }
  if (entries.length === 0) return '(empty)';
  return entries.join('\n');
}

function filterFindOutput(output) {
  const text = stripAnsi(output).trim();
  if (!text) return '';
  const lines = text.split('\n').filter(l => l.trim());
  const maxResults = 100;
  if (lines.length <= maxResults) return lines.join('\n');
  return [...lines.slice(0, maxResults), `[... ${lines.length} total results, showing first ${maxResults}]`].join('\n');
}

// ─── Filter Registry ───

const FILTER_RULES = [
  { name: 'git-status',  pattern: /^git\s+status\b/,               filter: filterGitStatus },
  { name: 'git-log',     pattern: /^git\s+log\b/,                  filter: filterGitLog },
  { name: 'git-diff',    pattern: /^git\s+diff\b/,                 filter: filterGitDiff },
  { name: 'git-push',    pattern: /^git\s+(push|pull|fetch)\b/,    filter: filterGitPush },
  { name: 'git-branch',  pattern: /^git\s+branch\b/,               filter: filterGitBranch },
  { name: 'test-runner',
    pattern: /(?:^|\s)(vitest|jest|pytest|npm\s+test|npx\s+(vitest|jest))\b/,
    filter: filterTestOutput },
  { name: 'tsc',         pattern: /(?:^|\s)(tsc|npx\s+tsc)\b/,     filter: filterTscOutput },
  { name: 'lint',        pattern: /(?:^|\s)(eslint|npx\s+eslint|prettier)\b/, filter: filterLintOutput },
  { name: 'ls',          pattern: /^ls\b/,                          filter: filterLsOutput },
  { name: 'find',        pattern: /^find\b/,                        filter: filterFindOutput },
];

function matchFilter(command) {
  const trimmed = command.trim();
  for (const rule of FILTER_RULES) {
    if (rule.pattern.test(trimmed)) return rule;
  }
  return null;
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write('Usage: node grove-filter.js <command> [args...]\n');
    process.exit(1);
  }

  const command = args.join(' ');
  const rule = matchFilter(command);

  if (!rule) {
    // No filter — execute and pass through
    try {
      execSync(command, { stdio: 'inherit', shell: true });
    } catch (e) {
      process.exit(e.status || 1);
    }
    return;
  }

  // Execute, capture, and filter
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      shell: true,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      timeout: 300_000, // 5 minutes
    });
  } catch (e) {
    exitCode = e.status || 1;
    stdout = e.stdout || '';
    stderr = e.stderr || '';
  }

  try {
    // Apply filter
    let filtered;
    if (exitCode !== 0 && !stdout.trim() && stderr.trim()) {
      filtered = stripAnsi(stderr).trim();
    } else if (exitCode !== 0 && stderr.trim()) {
      filtered = stripAnsi(stderr).trim() + '\n\n' + rule.filter(stdout);
    } else {
      filtered = rule.filter(stdout);
    }
    process.stdout.write(deduplicateLines(filtered));
  } catch {
    // Filter error — fall back to raw output
    process.stdout.write(truncateOutput(stripAnsi(stdout || stderr), 3000));
  }

  if (exitCode !== 0) process.exit(exitCode);
}

main();
