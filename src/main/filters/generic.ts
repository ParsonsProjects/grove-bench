/**
 * Generic output filters: ANSI stripping, deduplication, truncation.
 * These are reusable building blocks for command-specific filters.
 */

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07/g;

/** Remove all ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Collapse 3+ consecutive identical lines into the first line
 * plus a "... repeated N more times" message.
 */
export function deduplicateLines(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    result.push(lines[i]);
    let count = 0;
    while (i + 1 + count < lines.length && lines[i + 1 + count] === lines[i]) {
      count++;
    }
    if (count >= 2) {
      result.push(`... repeated ${count} more time${count === 1 ? '' : 's'}`);
      i += count + 1;
    } else {
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Truncate output beyond maxChars, keeping head and tail lines
 * with a "[... truncated N lines]" indicator.
 */
export function truncateOutput(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;

  const lines = text.split('\n');
  const tailCount = 5;
  const tail = lines.slice(-tailCount);

  // Build head until we exceed budget
  const headLines: string[] = [];
  let charCount = 0;
  for (const line of lines) {
    if (charCount + line.length + 1 > maxChars * 0.7) break;
    headLines.push(line);
    charCount += line.length + 1;
  }

  const omitted = lines.length - headLines.length - tailCount;
  if (omitted <= 0) {
    // Not enough to warrant truncation with tail — just cut from head
    return headLines.join('\n') + `\n[... truncated ${lines.length - headLines.length} lines]`;
  }

  return [
    ...headLines,
    `[... truncated ${omitted} lines]`,
    ...tail,
  ].join('\n');
}
