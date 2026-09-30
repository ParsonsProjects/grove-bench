import { describe, it, expect } from 'vitest';
import { stripMarkdown, plainSnippet, oneLine as collapse } from './plain-text.js';

const oneLine = (s: string) => stripMarkdown(s).replace(/\s+/g, ' ').trim();

describe('stripMarkdown', () => {
  it('drops heading, quote and list markers', () => {
    expect(oneLine('## Investigation summary\n\n> note\n\n- first\n2. second\n- [x] done')).toBe('Investigation summary note first second done');
  });

  it('turns a table into its cells, without the separator row', () => {
    expect(oneLine('| Test | Rate |\n| --- | :---: |\n| guest.spec | 18% |')).toBe('Test · Rate guest.spec · 18%');
  });

  it('drops short separator rows too, which GFM allows', () => {
    expect(oneLine('| a | b |\n|:--|--:|\n| 1 | 2 |')).toBe('a · b 1 · 2');
    expect(oneLine('| a | b |\n|-|-|\n| 1 | 2 |')).toBe('a · b 1 · 2');
  });

  it('keeps link and image text, not the target', () => {
    expect(oneLine('See [the PR](https://x.test/pr/1) and ![chart](c.png) or <https://x.test>')).toBe('See the PR and chart or https://x.test');
  });

  it('removes emphasis, strikethrough and code ticks', () => {
    expect(oneLine('**Bold**, *soft*, ~~old~~ and `npm test`.')).toBe('Bold, soft, old and npm test.');
  });

  it('keeps the code inside a fence but not the fence lines', () => {
    expect(oneLine('Run this:\n```bash\nnpm test\n```')).toBe('Run this: npm test');
  });

  it('leaves code exactly as written, inline or fenced', () => {
    expect(oneLine('Use `arr[0](x)` and `*x*` or **`npm test`**')).toBe('Use arr[0](x) and *x* or npm test');
    expect(oneLine('```sh\n# install deps\n- not a list | nor a table |\n```')).toBe('# install deps - not a list | nor a table |');
  });

  it('drops horizontal rules', () => {
    expect(oneLine('above\n\n---\n\nbelow\n***')).toBe('above below');
  });

  it('leaves names with underscores, globs, maths and shell pipes alone', () => {
    expect(oneLine('rename file_name_here in my_module.ts and __init__.py')).toBe('rename file_name_here in my_module.ts and __init__.py');
    expect(oneLine('Glob: src/**/*.ts and lib/**/*.test.ts')).toBe('Glob: src/**/*.ts and lib/**/*.test.ts');
    expect(oneLine('globs (*.ts|*.js) match')).toBe('globs (*.ts|*.js) match');
    expect(oneLine('2 * 3 * 4 is 24')).toBe('2 * 3 * 4 is 24');
    expect(oneLine('run npm test | tee log || true')).toBe('run npm test | tee log || true');
  });
});

describe('plainSnippet', () => {
  it('is one plain line, cut to length', () => {
    expect(plainSnippet('## Plan\n\n- fix **the** parser', 90)).toBe('Plan fix the parser');
    expect(plainSnippet('a'.repeat(300), 160)).toBe(`${'a'.repeat(160)}…`);
  });

  it('is empty for a message that is only markdown syntax', () => {
    expect(plainSnippet('---', 90)).toBe('');
    expect(plainSnippet('|---|---|', 90)).toBe('');
  });

  it('stays fast on input that makes the emphasis rules backtrack', () => {
    for (const text of ['call(**kwargs) '.repeat(16_000), '~~x '.repeat(64_000), '[\n'.repeat(64_000)]) {
      const start = performance.now();
      plainSnippet(text, 160);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});

describe('oneLine', () => {
  it('collapses whitespace and only adds an ellipsis when it cuts', () => {
    expect(collapse('  a \n\n b  ', 10)).toBe('a b');
    expect(collapse('abcdef', 3)).toBe('abc…');
  });
});
