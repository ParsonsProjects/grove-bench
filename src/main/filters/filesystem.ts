/**
 * Filesystem command output filters.
 * Compact directory listings and truncate search results.
 */

import { stripAnsi } from './generic.js';

/** Filter ls output — compact long-format listings. */
export function filterLsOutput(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  const lines = text.split('\n');

  // Detect long format (ls -l): lines start with permissions or "total"
  const isLongFormat = lines[0]?.startsWith('total ') || lines[0]?.match(/^[dlrwx-]{10}/);

  if (!isLongFormat) return text;

  // Filter long format: keep filename + type indicator, skip . and ..
  const entries: string[] = [];
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

/** Filter find output — truncate at 100 results with count. */
export function filterFindOutput(output: string): string {
  const text = stripAnsi(output).trim();
  if (!text) return '';

  const lines = text.split('\n').filter(l => l.trim());
  const maxResults = 100;

  if (lines.length <= maxResults) return lines.join('\n');

  return [
    ...lines.slice(0, maxResults),
    `[... ${lines.length} total results, showing first ${maxResults}]`,
  ].join('\n');
}
