import { describe, it, expect } from 'vitest';
import { attentionCount, badgeText, renderBadgeDataUrl } from './attention-badge.js';

describe('attentionCount', () => {
  const sessions = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c', completedAt: 1 },
    { id: 'd', completedAt: null },
  ];

  it('counts sessions that need input or are unread, once each', () => {
    const needsInput = (id: string) => id === 'a' || id === 'c';
    const unread = (id: string) => id === 'a' || id === 'd';
    expect(attentionCount(sessions, needsInput, unread)).toBe(2); // a (both), d (unread); c is completed
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
