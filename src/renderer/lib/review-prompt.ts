import type { ReviewComment } from './diff-types.js';

function fenceLang(filePath: string): string {
  const m = filePath.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/** Turn a batch of line comments into one prompt for the agent, grouped by
 *  file and ordered by line, GitHub-review style. */
export function buildReviewPrompt(comments: ReviewComment[]): string {
  if (comments.length === 0) return '';
  const byFile = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const list = byFile.get(c.filePath) ?? [];
    list.push(c);
    byFile.set(c.filePath, list);
  }
  const parts: string[] = [
    `Please address the following ${comments.length === 1 ? 'review comment' : `${comments.length} review comments`} on the current changes.`,
  ];
  for (const [filePath, list] of byFile) {
    list.sort((a, b) => a.startLine - b.startLine);
    for (const c of list) {
      const where = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
      const sideNote = c.side === 'old' ? ' (removed lines)' : '';
      const ctxNote = c.context ? ` — ${c.context}` : '';
      parts.push(`\n### ${filePath}:${where}${sideNote}${ctxNote}`);
      if (c.snippet.trim()) parts.push('```' + fenceLang(filePath) + '\n' + c.snippet + '\n```');
      parts.push(c.body.trim());
    }
  }
  return parts.join('\n');
}
