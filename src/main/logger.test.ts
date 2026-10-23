import { describe, it, expect } from 'vitest';
import { formatMessage } from './logger.js';

describe('formatMessage', () => {
  it('keeps an error\'s message, stack and code', () => {
    const err = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    const line = formatMessage('WARN', 'Could not read settings:', err);
    expect(line).toContain('Error: EBUSY: resource busy or locked');
    expect(line).toContain('logger.test.ts');
    expect(line).toContain('[code EBUSY]');
    expect(line).not.toContain('{}');
  });

  it('writes other values as JSON', () => {
    expect(formatMessage('INFO', 'state', { a: 1 }, 'x', 2)).toMatch(/\] state \{"a":1\} "x" 2\n$/);
  });

  it('never throws on values JSON can\'t take', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(formatMessage('INFO', 'odd', loop, 10n, undefined)).toMatch(/odd \[object Object\] 10 undefined\n$/);
  });
});
