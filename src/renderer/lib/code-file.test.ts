import { describe, it, expect } from 'vitest';
import { codeFileHtml, codeFileLines, splitHighlightedLines } from './code-file.js';

describe('splitHighlightedLines', () => {
  it('closes a span at the end of a line and opens it again on the next', () => {
    expect(splitHighlightedLines('<span class="a">x\n<span class="b">y\nz</span></span>w')).toEqual([
      '<span class="a">x</span>',
      '<span class="a"><span class="b">y</span></span>',
      '<span class="a"><span class="b">z</span></span>w',
    ]);
  });

  it('cuts plain text at each newline, keeping empty lines', () => {
    expect(splitHighlightedLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('codeFileLines', () => {
  it('colours the file in one go, so a comment over several lines stays a comment', () => {
    const lines = codeFileLines('/* one\n   two */\nconst a = 1;\n', 'src/app.ts');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('<span class="hljs-comment">/* one</span>');
    expect(lines[1]).toBe('<span class="hljs-comment">   two */</span>');
    expect(lines[2]).toContain('<span class="hljs-keyword">const</span>');
  });

  it('escapes a file in a language it has no colours for', () => {
    expect(codeFileLines('<script>alert(1)</script>\nb & c', 'notes.weird')).toEqual(['&lt;script&gt;alert(1)&lt;/script&gt;', 'b &amp; c']);
  });

  it('keeps markup in the file as text when it colours it', () => {
    const [line] = codeFileLines('const s = "<img src=x onerror=alert(1)>";', 'a.ts');
    expect(line).not.toContain('<img');
    expect(line).toContain('&lt;img');
  });

  it('reads Windows line endings, and a final newline ends the last line', () => {
    expect(codeFileLines('a\r\nb\r\n', 'x.txt')).toEqual(['a', 'b']);
    expect(codeFileLines('a\n\n', 'x.txt')).toEqual(['a', '']);
    expect(codeFileLines('', 'x.txt')).toEqual(['']);
  });
});

describe('codeFileHtml', () => {
  it('numbers each line and marks the ones a link named', () => {
    const { html, lineCount } = codeFileHtml('a\nb\nc\nd\n', 'x.txt', { start: 2, end: 3 });
    expect(lineCount).toBe(4);
    expect(html).toBe(
      '<div class="code-line" data-line="1">a</div>'
      + '<div class="code-line target" data-line="2">b</div>'
      + '<div class="code-line target" data-line="3">c</div>'
      + '<div class="code-line" data-line="4">d</div>',
    );
  });

  it('marks nothing without lines', () => {
    expect(codeFileHtml('a', 'x.txt', null).html).toBe('<div class="code-line" data-line="1">a</div>');
  });
});
