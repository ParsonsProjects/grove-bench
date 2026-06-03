import { describe, it, expect } from 'vitest';
import { parseTabShortcut } from './keyboard-shortcuts.js';

describe('parseTabShortcut', () => {
  it('maps Alt+1..4 to the corresponding tab', () => {
    expect(parseTabShortcut({ altKey: true, key: '1' })).toBe('activity');
    expect(parseTabShortcut({ altKey: true, key: '2' })).toBe('changes');
    expect(parseTabShortcut({ altKey: true, key: '3' })).toBe('checkpoints');
    expect(parseTabShortcut({ altKey: true, key: '4' })).toBe('terminal');
  });

  it('returns null without the Alt modifier', () => {
    expect(parseTabShortcut({ altKey: false, key: '1' })).toBeNull();
  });

  it('returns null for unrelated keys', () => {
    expect(parseTabShortcut({ altKey: true, key: '5' })).toBeNull();
    expect(parseTabShortcut({ altKey: true, key: 'a' })).toBeNull();
  });
});
