/** Split a snippet into match / non-match segments for <mark> highlighting. */
export function highlightSegments(snippet: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text: snippet, match: false }];
  const lower = snippet.toLowerCase();
  const out: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < snippet.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) { out.push({ text: snippet.slice(i), match: false }); break; }
    if (idx > i) out.push({ text: snippet.slice(i, idx), match: false });
    out.push({ text: snippet.slice(idx, idx + needle.length), match: true });
    i = idx + needle.length;
  }
  return out;
}
