import { describe, it, expect } from 'vitest';
import { stripMarkdown } from './plain-text.js';

const oneLine = (s: string) => stripMarkdown(s).replace(/\s+/g, ' ').trim();

describe('stripMarkdown', () => {
  it('drops heading, quote and list markers', () => {
    expect(oneLine('## Investigation summary\n\n> note\n\n- first\n2. second\n- [x] done')).toBe('Investigation summary note first second done');
  });

  it('turns a table into its cells, without the separator row', () => {
    expect(oneLine('| Test | Rate |\n| --- | :---: |\n| guest.spec | 18% |')).toBe('Test · Rate guest.spec · 18%');
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

  it('drops horizontal rules', () => {
    expect(oneLine('above\n\n---\n\nbelow\n***')).toBe('above below');
  });

  it('leaves names with underscores, globs, maths and shell pipes alone', () => {
    expect(oneLine('rename file_name_here in my_module.ts and __init__.py')).toBe('rename file_name_here in my_module.ts and __init__.py');
    expect(oneLine('Glob: src/**/*.ts and lib/**/*.test.ts')).toBe('Glob: src/**/*.ts and lib/**/*.test.ts');
    expect(oneLine('2 * 3 * 4 is 24')).toBe('2 * 3 * 4 is 24');
    expect(oneLine('run npm test | tee log || true')).toBe('run npm test | tee log || true');
  });
});
