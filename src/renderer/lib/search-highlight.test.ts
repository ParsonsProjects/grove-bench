import { describe, it, expect } from 'vitest';
import { highlightSegments } from './search-highlight.js';

const marked = (text: string, query: string, words = false) =>
  highlightSegments(text, query, { words }).filter((s) => s.match).map((s) => s.text);

describe('highlightSegments', () => {
  it('returns the text unmarked for an empty query or no match', () => {
    expect(highlightSegments('fix the parser', '  ')).toEqual([{ text: 'fix the parser', match: false }]);
    expect(highlightSegments('fix the parser', 'lexer')).toEqual([{ text: 'fix the parser', match: false }]);
  });

  it('marks every case-insensitive occurrence of the phrase', () => {
    expect(highlightSegments('Parser and parser', 'PARSER')).toEqual([
      { text: 'Parser', match: true },
      { text: ' and ', match: false },
      { text: 'parser', match: true },
    ]);
  });

  it('collapses whitespace in the query like the search does', () => {
    expect(marked('fix the parser bug', 'the   parser')).toEqual(['the parser']);
  });

  it('marks each word separately in words mode', () => {
    expect(marked('Sidebar revamp for the parser', 'parser sidebar', true)).toEqual(['Sidebar', 'parser']);
    // A phrase that never appears as a whole still highlights its words.
    expect(marked('Sidebar revamp for the parser', 'parser sidebar')).toEqual([]);
  });

  it('merges overlapping and adjacent word matches into one mark', () => {
    expect(marked('websocket', 'web socket', true)).toEqual(['websocket']);
    expect(marked('abcdef', 'abcd cdef', true)).toEqual(['abcdef']);
  });
});
