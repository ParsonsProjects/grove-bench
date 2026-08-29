import { describe, it, expect } from 'vitest';
import { buildCreatePrPrompt, buildFixCiPrompt, buildAddressReviewsPrompt } from './pr-prompt.js';
import type { PrReviewComment } from '../../shared/types.js';

describe('buildCreatePrPrompt()', () => {
  it('names the branch and base', () => {
    const prompt = buildCreatePrPrompt('feat/thing', 'develop');
    expect(prompt).toContain('feat/thing');
    expect(prompt).toContain('targeting develop');
  });

  it('covers commit, push, create, and already-exists steps', () => {
    const prompt = buildCreatePrPrompt('feat/thing', 'main');
    expect(prompt).toContain('uncommitted changes');
    expect(prompt).toContain('upstream tracking');
    expect(prompt).toContain('gh pr create');
    expect(prompt).toContain('already exists');
  });
});

describe('buildFixCiPrompt()', () => {
  it('names the PR, branch, and failing checks', () => {
    const prompt = buildFixCiPrompt(59, 'feat/thing', ['test', 'lint']);
    expect(prompt).toContain('PR #59');
    expect(prompt).toContain('feat/thing');
    expect(prompt).toContain('test, lint');
    expect(prompt).toContain('gh run view --log-failed');
  });

  it('omits the check list when names are unknown', () => {
    expect(buildFixCiPrompt(59, 'feat/thing', [])).not.toContain('Failing checks');
  });
});

describe('buildAddressReviewsPrompt()', () => {
  const comment = (over: Partial<PrReviewComment> = {}): PrReviewComment => ({
    id: 'comment-1', author: 'alice', authorAssociation: 'MEMBER', body: 'Fix this', ...over,
  });

  it('lists comments with their file anchors', () => {
    const prompt = buildAddressReviewsPrompt(59, 'feat/thing', [
      comment({ path: 'src/a.ts', line: 12, body: 'Rename this' }),
      comment({ id: 'review-2', author: 'bob', body: 'Overall looks fine' }),
    ]);
    expect(prompt).toContain('PR #59');
    expect(prompt).toContain('src/a.ts:12 — alice: Rename this');
    expect(prompt).toContain('bob: Overall looks fine');
  });

  it('truncates long bodies and caps the comment count', () => {
    const many = Array.from({ length: 40 }, (_, i) => comment({ id: `c${i}`, body: 'x'.repeat(600) }));
    const prompt = buildAddressReviewsPrompt(1, 'b', many);
    expect(prompt).toContain('…');
    expect(prompt).toContain('10 more comments');
  });
});
