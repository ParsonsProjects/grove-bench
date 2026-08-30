/**
 * Heuristic for when an assistant response earns an "open rendered preview"
 * affordance: it should read as a *document* (plan, report, audit, draft),
 * not a conversational reply that happens to contain a little formatting.
 */

/** Count completed fenced code blocks (``` pairs). */
function countFences(text: string): number {
  const fences = text.match(/^\s*(```|~~~)/gm) ?? [];
  return Math.floor(fences.length / 2);
}

/** Remove fenced block contents so code doesn't masquerade as headings/lists. */
function stripFencedBlocks(text: string): string {
  return text.replace(/^\s*(```|~~~).*$[\s\S]*?(^\s*\1\s*$|$(?![\s\S]))/gm, '');
}

/** A GFM table needs a pipe row followed by a separator row (| --- | --- |). */
function hasTable(text: string): boolean {
  return /^\s*\|?.+\|.*$\r?\n\s*\|?\s*:?-{2,}[\s:|-]*$/m.test(text);
}

/** Length above which any markdown structure at all qualifies as a document. */
const LONG_RESPONSE_CHARS = 1500;

export function isPreviewableMarkdown(text: string): boolean {
  if (!text) return false;

  const fenceCount = countFences(text);
  const prose = stripFencedBlocks(text);

  const headings = (prose.match(/^#{1,6}\s+\S/gm) ?? []).length;
  if (headings >= 2) return true;
  if (hasTable(prose)) return true;
  if (fenceCount >= 3) return true;

  const listItems = (prose.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) ?? []).length;
  const hasStructure = headings >= 1 || listItems >= 3 || fenceCount >= 1 || /^>\s/m.test(prose);
  return hasStructure && text.length > LONG_RESPONSE_CHARS;
}
