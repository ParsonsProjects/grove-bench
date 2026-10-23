import { describe, it, expect, beforeEach } from 'vitest';
import { reviewStore } from './review.svelte.js';

const SID = 'review-session';

beforeEach(() => {
  reviewStore.clear(SID);
  localStorage.clear();
});

describe('reviewStore — viewed', () => {
  it('marks viewed at a content hash and clears when the hash changes', () => {
    reviewStore.setViewed(SID, 'a.ts', 'h1', true);
    expect(reviewStore.isViewed(SID, 'a.ts', 'h1')).toBe(true);
    expect(reviewStore.changedSinceViewed(SID, 'a.ts', 'h1')).toBe(false);

    expect(reviewStore.isViewed(SID, 'a.ts', 'h2')).toBe(false);
    expect(reviewStore.changedSinceViewed(SID, 'a.ts', 'h2')).toBe(true);

    reviewStore.setViewed(SID, 'a.ts', 'h2', false);
    expect(reviewStore.changedSinceViewed(SID, 'a.ts', 'h2')).toBe(false);
  });

  it('does not flip the verdict when the hash is unknown', () => {
    reviewStore.setViewed(SID, 'a.ts', 'h1', true);
    expect(reviewStore.isViewed(SID, 'a.ts', undefined)).toBe(true);
    expect(reviewStore.changedSinceViewed(SID, 'a.ts', undefined)).toBe(false);
    // Marked viewed without a hash: matches whatever content shows up later.
    reviewStore.setViewed(SID, 'b.ts', undefined, true);
    expect(reviewStore.isViewed(SID, 'b.ts', 'later')).toBe(true);
    expect(reviewStore.changedSinceViewed(SID, 'b.ts', 'later')).toBe(false);
  });

  it('persists to localStorage and reloads', () => {
    reviewStore.setViewed(SID, 'a.ts', 'h1', true);
    reviewStore.bySession = {};
    expect(reviewStore.isViewed(SID, 'a.ts', 'h1')).toBe(true);
  });
});

describe('reviewStore — comments', () => {
  it('adds, updates, removes, and clears comments', () => {
    const c = reviewStore.addComment(SID, { filePath: 'a.ts', side: 'new', startLine: 1, endLine: 2, snippet: 'x', body: 'first' });
    expect(reviewStore.getComments(SID)).toHaveLength(1);
    reviewStore.updateComment(SID, c.id, 'edited');
    expect(reviewStore.getComments(SID)[0].body).toBe('edited');
    reviewStore.addComment(SID, { filePath: 'b.ts', side: 'old', startLine: 3, endLine: 3, snippet: '', body: 'second' });
    reviewStore.removeComment(SID, c.id);
    expect(reviewStore.getComments(SID).map(c => c.body)).toEqual(['second']);
    reviewStore.clearComments(SID);
    expect(reviewStore.getComments(SID)).toEqual([]);
  });
});
