import { describe, it, expect } from 'vitest';
import { errorMessage } from './error-message.js';

describe('errorMessage', () => {
  it("gives an error's message", () => {
    expect(errorMessage(new Error('git push failed'))).toBe('git push failed');
    expect(errorMessage({ message: 'from IPC' })).toBe('from IPC');
  });

  it('gives the value itself when there is no message', () => {
    expect(errorMessage(new TypeError(''))).toBe('TypeError');
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(42)).toBe('42');
  });
});
