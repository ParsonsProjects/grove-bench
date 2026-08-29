import { describe, it, expect } from 'vitest';
import { buildCreatePrPrompt } from './pr-prompt.js';

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
