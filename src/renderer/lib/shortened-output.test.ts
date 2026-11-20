import { describe, it, expect } from 'vitest';
import { shortenedNote } from './shortened-output.js';

const note = (families: ('test' | 'lint' | 'git' | 'install' | 'build')[], savedTokens: number) =>
  shortenedNote({ families, savedTokens, fullChars: 0, modelChars: 0, file: 'C:\\out.txt' });

describe('shortenedNote', () => {
  it('names the kind of output and the tokens saved', () => {
    expect(note(['test'], 2240)).toBe('The agent got a shorter version of this test output, about 2.2k tokens fewer. It can read the full output if it needs to.');
  });

  it('lists several kinds', () => {
    expect(note(['install', 'test'], 300)).toContain('this install and test output, about 300 tokens fewer');
    expect(note(['install', 'lint', 'build'], 300)).toContain('this install, lint and build output');
  });

  it('says just output when it has no kind', () => {
    expect(note([], 10)).toContain('this output, about 10 tokens');
  });
});
