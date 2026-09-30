import { describe, it, expect } from 'vitest';
import { splitStreamingMarkdown } from './markdown-stream.js';

describe('splitStreamingMarkdown', () => {
  it('cuts after a blank line once the next block has started', () => {
    expect(splitStreamingMarkdown('First para.\n\nSecond')).toEqual({ settled: ['First para.\n\n'], tail: 'Second' });
  });

  it('waits for the next line before cutting', () => {
    expect(splitStreamingMarkdown('First para.\n\n')).toEqual({ settled: [], tail: 'First para.\n\n' });
  });

  it('keeps an indented line with the block above', () => {
    const text = '- item\n\n  more of the item\n';
    expect(splitStreamingMarkdown(text)).toEqual({ settled: [], tail: text });
  });

  it('never cuts inside a code fence, even at a blank line', () => {
    const text = 'Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
    expect(splitStreamingMarkdown(text)).toEqual({ settled: ['Intro\n\n'], tail: '```ts\nconst a = 1;\n\nconst b = 2;\n' });
  });

  it('cuts after a fence closes', () => {
    const text = '```\ncode\n```\n\nAfter';
    expect(splitStreamingMarkdown(text)).toEqual({ settled: ['```\ncode\n```\n\n'], tail: 'After' });
  });

  it('only closes a fence with the same marker, at least as long', () => {
    const text = '````\n```\n\nstill code\n';
    expect(splitStreamingMarkdown(text).settled).toEqual([]);
    expect(splitStreamingMarkdown('~~~\n```\n\nx\n').settled).toEqual([]);
  });

  it('keeps earlier cuts as more text arrives', () => {
    const full = 'One.\n\nTwo.\n\n```\nx\n\ny\n```\n\nThree and more';
    let prev: string[] = [];
    for (let i = 1; i <= full.length; i++) {
      const { settled, tail } = splitStreamingMarkdown(full.slice(0, i));
      expect(settled.join('') + tail).toBe(full.slice(0, i));
      expect(settled.slice(0, prev.length)).toEqual(prev);
      prev = settled;
    }
    expect(prev).toEqual(['One.\n\n', 'Two.\n\n', '```\nx\n\ny\n```\n\n']);
  });
});
