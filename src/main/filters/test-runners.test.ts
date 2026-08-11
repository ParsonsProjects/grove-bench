import { describe, it, expect } from 'vitest';
import { filterTestOutput } from './test-runners.js';

describe('filterTestOutput', () => {
  it('extracts failures and summary from vitest output', () => {
    const input = [
      '',
      ' ✓ src/utils.test.ts (3 tests) 45ms',
      ' ✓ src/app.test.ts (5 tests) 120ms',
      ' ✗ src/broken.test.ts (2 tests | 1 failed) 80ms',
      '   × should handle error',
      '     → expected true, got false',
      '',
      ' Test Files  2 passed | 1 failed (3)',
      ' Tests       9 passed | 1 failed (10)',
      ' Duration    250ms',
    ].join('\n');
    const result = filterTestOutput(input);
    // Should include failure details
    expect(result).toContain('should handle error');
    expect(result).toContain('expected true, got false');
    // Should include summary
    expect(result).toContain('passed');
    expect(result).toContain('failed');
    // Should NOT include passing test file details
    expect(result).not.toContain('src/utils.test.ts');
    expect(result).not.toContain('src/app.test.ts');
  });

  it('returns compact summary when all tests pass', () => {
    const input = [
      ' ✓ src/utils.test.ts (3 tests) 45ms',
      ' ✓ src/app.test.ts (5 tests) 120ms',
      '',
      ' Test Files  2 passed (2)',
      ' Tests       8 passed (8)',
      ' Duration    170ms',
    ].join('\n');
    const result = filterTestOutput(input);
    expect(result).toContain('passed');
    // Should NOT list individual passing files
    expect(result).not.toContain('src/utils.test.ts');
  });

  it('handles jest-style output', () => {
    const input = [
      'PASS src/utils.test.ts',
      'FAIL src/broken.test.ts',
      '  ● should handle error',
      '    expect(received).toBe(expected)',
      '    Expected: true',
      '    Received: false',
      '',
      'Test Suites: 1 failed, 1 passed, 2 total',
      'Tests:       1 failed, 7 passed, 8 total',
    ].join('\n');
    const result = filterTestOutput(input);
    expect(result).toContain('should handle error');
    expect(result).toContain('Expected: true');
    expect(result).not.toContain('PASS src/utils.test.ts');
  });

  it('strips ANSI from test output', () => {
    const input = '\x1b[32m ✓\x1b[0m all passing\n\n Test Files  1 passed (1)\n Tests  3 passed (3)';
    const result = filterTestOutput(input);
    expect(result).not.toContain('\x1b[');
    expect(result).toContain('passed');
  });

  it('handles empty output', () => {
    expect(filterTestOutput('')).toBe('');
  });

  it('preserves error stack traces in failures', () => {
    const input = [
      'FAIL src/api.test.ts',
      '  ● GET /users > should return 200',
      '    TypeError: fetch is not defined',
      '      at Object.<anonymous> (src/api.test.ts:15:5)',
      '',
      'Test Suites: 1 failed, 0 passed, 1 total',
      'Tests:       1 failed, 0 passed, 1 total',
    ].join('\n');
    const result = filterTestOutput(input);
    expect(result).toContain('TypeError: fetch is not defined');
    expect(result).toContain('src/api.test.ts:15:5');
  });
});
