import { describe, it, expect } from 'vitest';
import { attentionCount, badgeText, renderBadgeDataUrl } from './attention-badge.js';

describe('attentionCount', () => {
  const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('counts sessions that need input or are unread, once each', () => {
    const needsInput = (id: string) => id === 'a';
    const unread = (id: string) => id === 'a' || id === 'c';
    expect(attentionCount(sessions, needsInput, unread)).toBe(2); // a (both), c (unread)
  });

  it('is zero when nothing is pending', () => {
    expect(attentionCount(sessions, () => false, () => false)).toBe(0);
  });
});

describe('badgeText', () => {
  it('caps at 9+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
  });
});

describe('renderBadgeDataUrl', () => {
  it('returns null for zero and does not throw without a canvas backend', () => {
    expect(renderBadgeDataUrl(0)).toBeNull();
    // jsdom has no 2d context; must degrade to null, never throw
    expect(() => renderBadgeDataUrl(3)).not.toThrow();
  });
});
