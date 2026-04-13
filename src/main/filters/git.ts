/**
 * Git command output filters.
 * Compress verbose git output to essential information.
 */

import { stripAnsi, truncateOutput } from './generic.js';

/** Filter git status output to a summary + file list. */
export function filterGitStatus(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return 'clean';

  const lines = text.split('\n').filter(l => l.trim());
  const counts: Record<string, number> = {};
  const files: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(.{1,2})\s+(.+)$/);
    if (!match) continue;
    const code = match[1].trim();
    const file = match[2].trim();
    counts[code] = (counts[code] || 0) + 1;
    files.push(`  ${code} ${file}`);
  }

  const summary = Object.entries(counts)
    .map(([code, count]) => `${code} ${count}`)
    .join(' | ');

  // Cap file list at 30 entries
  const maxFiles = 30;
  const fileList = files.length > maxFiles
    ? [...files.slice(0, maxFiles), `  ... and ${files.length - maxFiles} more`]
    : files;

  return `${summary}\n${fileList.join('\n')}`;
}

/** Filter git log to compact hash + subject lines. */
export function filterGitLog(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  const lines = text.split('\n');

  // Check if already in --oneline format (no "commit " prefix)
  const isOneline = !lines[0]?.startsWith('commit ');
  if (isOneline) {
    // Already compact — just cap at 20 lines
    return lines.slice(0, 20).join('\n') +
      (lines.length > 20 ? `\n... ${lines.length - 20} more commits` : '');
  }

  // Parse full format: extract hash + subject
  const entries: string[] = [];
  for (const line of lines) {
    if (line.startsWith('commit ')) {
      const hash = line.slice(7, 14); // short hash
      entries.push(hash);
    } else if (line.startsWith('    ') && entries.length > 0) {
      // Subject line — append to last entry
      const lastIdx = entries.length - 1;
      if (!entries[lastIdx].includes(' ')) {
        entries[lastIdx] += ' ' + line.trim();
      }
    }
  }

  const maxEntries = 20;
  const result = entries.slice(0, maxEntries);
  if (entries.length > maxEntries) {
    result.push(`... ${entries.length - maxEntries} more commits`);
  }

  return result.join('\n');
}

/** Filter git diff to show file names + truncated hunks. */
export function filterGitDiff(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  return truncateOutput(text, 3000);
}

/** Filter git push/pull/fetch to summary lines. */
export function filterGitPush(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  const lines = text.split('\n');
  const keep = lines.filter(line => {
    // Keep ref update lines, errors, and remote messages
    if (line.match(/^\s+\S+\.\.\S+\s+/)) return true; // ref updates
    if (line.match(/^To |^From /)) return true;
    if (line.match(/error|fatal|reject|denied/i)) return true;
    if (line.match(/hint:/i)) return true;
    if (line.match(/->/)) return true;
    if (line.startsWith('Already up to date')) return true;
    return false;
  });

  // If nothing matched, it might be an error — return all
  return keep.length > 0 ? keep.join('\n') : text;
}

/** Filter git branch output — already compact, just pass through. */
export function filterGitBranch(output: string): string {
  return stripAnsi(output).trim();
}
