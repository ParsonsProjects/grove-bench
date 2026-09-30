import type { DiffLine } from './diff-types.js';

/** Parse a unified diff (one or more files) into display lines. */
export function parseDiffLines(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  // Lines the current hunk still has to come, from its header. While any
  // are left, a line is content even when it starts with `---` or `+++`
  // (a removed SQL comment, an added `++i`): only outside a hunk are those
  // file headers.
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of lines) {
    const inHunk = oldLeft > 0 || newLeft > 0;
    if (!inHunk && (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:') || line.startsWith('===='))) continue;
    if (!inHunk && line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[3], 10);
        const oldCount = m[2] === undefined ? 1 : parseInt(m[2], 10);
        const newCount = m[4] === undefined ? 1 : parseInt(m[4], 10);
        oldLeft = oldCount;
        newLeft = newCount;
        result.push({
          type: 'hunk',
          text: line,
          hunk: { oldStart: oldLine, oldCount, newStart: newLine, newCount },
        });
      } else {
        result.push({ type: 'hunk', text: line });
      }
      continue;
    }
    if (line.startsWith('+')) {
      result.push({ type: 'add', text: line.slice(1), lineNum: newLine, newLineNum: newLine });
      newLine++;
      newLeft = Math.max(0, newLeft - 1);
    } else if (line.startsWith('-')) {
      result.push({ type: 'del', text: line.slice(1), lineNum: oldLine, oldLineNum: oldLine });
      oldLine++;
      oldLeft = Math.max(0, oldLeft - 1);
    } else if (line.startsWith(' ')) {
      result.push({ type: 'context', text: line.slice(1), lineNum: newLine, oldLineNum: oldLine, newLineNum: newLine });
      oldLine++;
      newLine++;
      oldLeft = Math.max(0, oldLeft - 1);
      newLeft = Math.max(0, newLeft - 1);
    }
  }
  return result;
}
