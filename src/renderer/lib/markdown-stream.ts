/**
 * Split a Markdown reply that is still streaming into blocks that are done
 * and the tail that is still growing, so each flush re-renders only the tail.
 *
 * A block ends at a blank line outside a code fence, once the line after it
 * has started and isn't indented: an indented line may still belong to the
 * block above (a list item's next paragraph, indented code). Text is only
 * ever appended while streaming, so a cut, once made, stays where it is.
 *
 * Rendering blocks one at a time is a preview: a loose list or an HTML
 * block split by a blank line can look slightly different until the reply
 * finishes and is rendered whole.
 */
export function splitStreamingMarkdown(text: string): { settled: string[]; tail: string } {
  const settled: string[] = [];
  let blockStart = 0;
  let fence: { char: string; len: number } | null = null;
  let afterBlank = false;
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);

    if (afterBlank && fence === null && line.length > 0 && !/^\s/.test(line)) {
      settled.push(text.slice(blockStart, pos));
      blockStart = pos;
    }
    afterBlank = false;

    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (marker) fence = { char: marker[1][0], len: marker[1].length };
      else if (nl !== -1 && line.trim() === '') afterBlank = true;
    } else if (marker && marker[1][0] === fence.char && marker[1].length >= fence.len && line.slice(marker[0].length).trim() === '') {
      fence = null;
    }

    if (nl === -1) break;
    pos = nl + 1;
  }
  return { settled, tail: text.slice(blockStart) };
}
