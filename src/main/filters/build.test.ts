import { describe, it, expect } from 'vitest';
import { filterTscOutput, filterLintOutput } from './build.js';

describe('filterTscOutput', () => {
  it('extracts error lines and count', () => {
    const input = [
      "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/app.ts(15,3): error TS2345: Argument of type 'null' is not assignable.",
      "src/utils.ts(3,1): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      '',
      'Found 3 errors.',
    ].join('\n');
    const result = filterTscOutput(input);
    expect(result).toContain('TS2322');
    expect(result).toContain('TS2345');
    expect(result).toContain('TS7006');
    expect(result).toContain('3 error');
  });

  it('returns compact message when no errors', () => {
    const input = '';
    const result = filterTscOutput(input);
    expect(result).toBe('ok');
  });

  it('strips ANSI codes from tsc output', () => {
    const input = "\x1b[91merror\x1b[0m TS2322: Type mismatch\n\nFound 1 error.";
    const result = filterTscOutput(input);
    expect(result).not.toContain('\x1b[');
    expect(result).toContain('TS2322');
  });
});

describe('filterLintOutput', () => {
  it('groups errors by rule and counts', () => {
    const input = [
      '/src/app.ts',
      '  10:5  error  Unexpected any    @typescript-eslint/no-explicit-any',
      '  15:3  error  Unexpected any    @typescript-eslint/no-explicit-any',
      '  20:1  error  Missing return    consistent-return',
      '',
      '✖ 3 problems (3 errors, 0 warnings)',
    ].join('\n');
    const result = filterLintOutput(input);
    expect(result).toContain('no-explicit-any');
    expect(result).toContain('consistent-return');
    expect(result).toContain('3 problems');
  });

  it('returns compact message when no issues', () => {
    expect(filterLintOutput('')).toBe('ok');
  });

  it('handles warning-only output', () => {
    const input = [
      '/src/app.ts',
      '  5:1  warning  Unexpected console  no-console',
      '',
      '✖ 1 problem (0 errors, 1 warning)',
    ].join('\n');
    const result = filterLintOutput(input);
    expect(result).toContain('no-console');
    expect(result).toContain('1 problem');
  });
});
