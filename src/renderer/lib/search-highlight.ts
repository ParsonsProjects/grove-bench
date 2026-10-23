export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split text into match / non-match segments for <mark> highlighting. The query
 * matches as one phrase (whitespace runs collapsed, as the search does), or with
 * `words` each space-separated term is highlighted wherever it appears.
 */
export function highlightSegments(text: string, query: string, opts: { words?: boolean } = {}): HighlightSegment[] {
  const phrase = query.replace(/\s+/g, ' ').trim().toLowerCase();
  const needles = (opts.words ? phrase.split(' ') : [phrase]).filter(Boolean);
  if (needles.length === 0) return [{ text, match: false }];

  // Mark every matched char, then group runs, so overlapping terms merge.
  const lower = text.toLowerCase();
  const marked = new Uint8Array(text.length);
  let found = false;
  for (const needle of needles) {
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
      marked.fill(1, i, i + needle.length);
      found = true;
    }
  }
  if (!found) return [{ text, match: false }];

  const out: HighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      out.push({ text: text.slice(start, i), match: marked[start] === 1 });
      start = i;
    }
  }
  return out;
}
