import { describe, it, expect } from 'vitest';
import { RecentCache, languageForPath, highlightLine, highlightLineUncached, linesToColour, MAX_DEFERRED_LINE, MAX_DEFERRED_LINES, wordDiffSegments, hunkLineIndices } from './diff-highlight.js';
import type { DiffLine } from './diff-types.js';

describe('languageForPath', () => {
  it('maps known extensions to highlight.js languages', () => {
    expect(languageForPath('src/index.ts')).toBe('typescript');
    expect(languageForPath('a/b/style.scss')).toBe('scss');
    expect(languageForPath('main.PY')).toBe('python');
  });

  it('returns null for unknown or extensionless paths', () => {
    expect(languageForPath('LICENSE')).toBeNull();
    expect(languageForPath('weird.xyz')).toBeNull();
  });
});

describe('highlightLineUncached', () => {
  it('gives the same HTML as highlightLine', () => {
    const text = 'const uncached = a < b;';
    expect(highlightLineUncached(text, 'typescript')).toBe(highlightLine(text, 'typescript'));
  });

  it('escapes plain text when no language is given', () => {
    expect(highlightLineUncached('a < b', null)).toBe('a &lt; b');
  });
});

describe('linesToColour', () => {
  const line = (type: DiffLine['type'], text: string): DiffLine => ({ type, text });

  it('takes each distinct code line once, not hunk headers', () => {
    const texts = linesToColour([line('hunk', '@@ -1 +1 @@'), line('context', 'a'), line('del', 'b'), line('add', 'c'), line('add', 'a')]);
    expect(texts && [...texts]).toEqual(['a', 'b', 'c']);
  });

  it('leaves out lines too long to colour in one go', () => {
    const texts = linesToColour([line('add', 'x'.repeat(MAX_DEFERRED_LINE)), line('add', 'y'.repeat(MAX_DEFERRED_LINE + 1))]);
    expect(texts?.size).toBe(1);
    expect(texts?.has('x'.repeat(MAX_DEFERRED_LINE))).toBe(true);
  });

  it('gives up on a diff with too many distinct lines', () => {
    const lines = Array.from({ length: MAX_DEFERRED_LINES }, (_, i) => line('add', `line ${i}`));
    expect(linesToColour(lines)?.size).toBe(MAX_DEFERRED_LINES);
    expect(linesToColour([...lines, line('add', 'one more')])).toBeNull();
  });
});

describe('highlightLine', () => {
  it('HTML-escapes plain text when no language is given', () => {
    expect(highlightLine('a < b && c > d', null)).toBe('a &lt; b &amp;&amp; c &gt; d');
  });

  it('preserves code content for a known language', () => {
    // Note: DOMPurify span output isn't asserted here — the jsdom window is replaced in
    // the test setup, which prevents DOMPurify from retaining markup. Content preservation
    // and XSS-inertness (below) are the load-bearing guarantees.
    const html = highlightLine('const x = 1;', 'typescript');
    expect(html).toContain('const');
    expect(html).toContain('x');
  });

  it('renders embedded markup inert (no live script tag)', () => {
    const html = highlightLine('const s = "<script>alert(1)</script>";', 'typescript');
    expect(html).not.toMatch(/<script>/i);
  });
});

describe('wordDiffSegments', () => {
  it('marks only the changed words in each side', () => {
    const { del, add } = wordDiffSegments('the quick brown fox', 'the slow brown fox');
    expect(del.filter(s => s.changed).map(s => s.text.trim())).toEqual(['quick']);
    expect(add.filter(s => s.changed).map(s => s.text.trim())).toEqual(['slow']);
    // unchanged words appear on both sides
    expect(del.some(s => !s.changed && s.text.includes('brown'))).toBe(true);
  });

  it('handles a pure addition', () => {
    const { del, add } = wordDiffSegments('a', 'a b');
    expect(del.every(s => !s.changed)).toBe(true);
    expect(add.some(s => s.changed)).toBe(true);
  });
});

describe('hunkLineIndices', () => {
  it('returns indices of hunk lines', () => {
    const lines: DiffLine[] = [
      { type: 'hunk', text: '@@ -1 +1 @@' },
      { type: 'add', text: 'x' },
      { type: 'context', text: 'y' },
      { type: 'hunk', text: '@@ -9 +9 @@' },
    ];
    expect(hunkLineIndices(lines)).toEqual([0, 3]);
  });

  it('returns empty when there are no hunks', () => {
    expect(hunkLineIndices([{ type: 'add', text: 'x' }])).toEqual([]);
  });
});

import { intralineRanges, markRanges, textFingerprint } from './diff-highlight.js';

describe('intralineRanges', () => {
  it('marks only the changed words on each side', () => {
    const r = intralineRanges('const a = foo(1);', 'const a = bar(1);')!;
    expect(r.del).toEqual([[10, 13]]);
    expect(r.add).toEqual([[10, 13]]);
  });

  it('returns null for lines that were mostly rewritten', () => {
    expect(intralineRanges('alpha beta gamma', 'one two three')).toBeNull();
  });

  it('returns null for blank lines', () => {
    expect(intralineRanges('   ', 'x')).toBeNull();
  });
});

describe('markRanges', () => {
  it('wraps ranges in mark elements without breaking existing spans', () => {
    const html = '<span class="hljs-keyword">const</span> a = foo(1);';
    const out = markRanges(html, [[10, 13]]);
    expect(out).toBe('<span class="hljs-keyword">const</span> a = <mark class="diff-mark">foo</mark>(1);');
  });

  it('splits a range that crosses a span boundary', () => {
    const html = '<span>ab</span>cd';
    expect(markRanges(html, [[1, 3]])).toBe('<span>a<mark class="diff-mark">b</mark></span><mark class="diff-mark">c</mark>d');
  });

  it('leaves html alone with no ranges', () => {
    expect(markRanges('<b>x</b>', [])).toBe('<b>x</b>');
  });
});

describe('textFingerprint', () => {
  it('differs for different text and is stable', () => {
    expect(textFingerprint('a')).toBe(textFingerprint('a'));
    expect(textFingerprint('a')).not.toBe(textFingerprint('b'));
  });
});

describe('RecentCache', () => {
  it('works a value out once, then serves it from the cache', () => {
    const cache = new RecentCache<number>(10);
    let made = 0;
    expect(cache.get('a', () => ++made)).toBe(1);
    expect(cache.get('a', () => ++made)).toBe(1);
    expect(made).toBe(1);
  });

  it('when full, drops the least recently used tenth, not everything', () => {
    const cache = new RecentCache<string>(10);
    for (let i = 0; i < 10; i++) cache.get(`k${i}`, () => `v${i}`);
    cache.get('k0', () => 'again'); // k0 is now the most recent
    cache.get('k10', () => 'v10'); // full: k1 goes

    expect(cache.size).toBe(10);
    let remade = '';
    expect(cache.get('k0', () => (remade = 'k0'))).toBe('v0');
    expect(cache.get('k2', () => (remade = 'k2'))).toBe('v2');
    expect(remade).toBe('');
    expect(cache.get('k1', () => 'remade')).toBe('remade');
  });
});
