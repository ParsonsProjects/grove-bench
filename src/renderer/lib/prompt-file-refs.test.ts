import { describe, it, expect, vi } from 'vitest';
import { extractAtRefs, buildRefTags, buildOutgoingMessage } from './prompt-file-refs.js';

describe('extractAtRefs()', () => {
  it('extracts a single file reference', () => {
    expect(extractAtRefs('look at @src/main/ipc.ts please')).toEqual(['src/main/ipc.ts']);
  });

  it('extracts multiple references', () => {
    expect(extractAtRefs('@a.ts and @b/c.svelte')).toEqual(['a.ts', 'b/c.svelte']);
  });

  it('keeps the trailing slash that marks a folder', () => {
    expect(extractAtRefs('summarize @src/renderer/')).toEqual(['src/renderer/']);
  });

  it('returns empty for text without references', () => {
    expect(extractAtRefs('no refs here')).toEqual([]);
  });

  it('stops at whitespace (paths with spaces are not supported)', () => {
    expect(extractAtRefs('@my file.ts')).toEqual(['my']);
  });
});

describe('buildRefTags()', () => {
  it('wraps file content in a <file> tag with the path', async () => {
    const readFile = vi.fn().mockResolvedValue('const x = 1;');
    const tags = await buildRefTags(['src/a.ts'], readFile);
    expect(readFile).toHaveBeenCalledWith('src/a.ts');
    expect(tags).toEqual(['<file path="src/a.ts">\nconst x = 1;\n</file>']);
  });

  it('uses a <folder> tag for refs ending in a slash', async () => {
    const readFile = vi.fn().mockResolvedValue('a.ts\nb.ts');
    const tags = await buildRefTags(['src/'], readFile);
    expect(tags).toEqual(['<folder path="src/">\na.ts\nb.ts\n</folder>']);
  });

  it('marks unreadable refs instead of dropping them', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const tags = await buildRefTags(['missing.ts'], readFile);
    expect(tags).toEqual(['<file path="missing.ts">\n(could not read)\n</file>']);
  });

  it('preserves ref order across mixed successes and failures', async () => {
    const readFile = vi.fn(async (p: string) => {
      if (p === 'bad.ts') throw new Error('ENOENT');
      return `content of ${p}`;
    });
    const tags = await buildRefTags(['a.ts', 'bad.ts', 'c.ts'], readFile);
    expect(tags[0]).toContain('content of a.ts');
    expect(tags[1]).toContain('(could not read)');
    expect(tags[2]).toContain('content of c.ts');
  });
});

describe('buildOutgoingMessage()', () => {
  it('prefixes tags before the user text, separated by a blank line', () => {
    const out = buildOutgoingMessage(['<file path="a.ts">\nx\n</file>'], 'explain @a.ts');
    expect(out).toBe('<file path="a.ts">\nx\n</file>\n\nexplain @a.ts');
  });

  it('returns the text unchanged when there are no tags', () => {
    expect(buildOutgoingMessage([], 'hello')).toBe('hello');
  });
});

// End-to-end shape: what the LLM receives for a prompt with an @-reference.
describe('@ file inclusion pipeline', () => {
  it('produces an outgoing message containing the referenced file content', async () => {
    const text = 'what does @src/util.ts do?';
    const readFile = vi.fn().mockResolvedValue('export const answer = 42;');

    const tags = await buildRefTags(extractAtRefs(text), readFile);
    const outgoing = buildOutgoingMessage(tags, text);

    expect(outgoing).toBe(
      '<file path="src/util.ts">\nexport const answer = 42;\n</file>\n\nwhat does @src/util.ts do?',
    );
  });
});
