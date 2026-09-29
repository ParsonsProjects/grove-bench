import { describe, it, expect } from 'vitest';
import { loadErrorHint } from './preview-text.js';

describe('loadErrorHint', () => {
  it('explains a refused connection', () => {
    expect(loadErrorHint({ code: -102, description: 'ERR_CONNECTION_REFUSED' })).toContain('dev server running');
  });

  it('falls back to the raw description and code', () => {
    expect(loadErrorHint({ code: -999, description: 'ERR_SOMETHING_NEW' })).toBe('ERR_SOMETHING_NEW (-999)');
    expect(loadErrorHint({ code: -1, description: '' })).toBe('Unknown error (-1)');
  });
});
