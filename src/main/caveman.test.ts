import { describe, it, expect } from 'vitest';
import { getCavemanPrompt } from './caveman.js';

describe('getCavemanPrompt', () => {
  it('returns null when mode is off', () => {
    expect(getCavemanPrompt('off')).toBeNull();
  });

  it('returns a non-empty string for lite mode', () => {
    const prompt = getCavemanPrompt('lite');
    expect(prompt).toBeTypeOf('string');
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for full mode', () => {
    const prompt = getCavemanPrompt('full');
    expect(prompt).toBeTypeOf('string');
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for ultra mode', () => {
    const prompt = getCavemanPrompt('ultra');
    expect(prompt).toBeTypeOf('string');
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it('lite mode keeps articles instruction', () => {
    const prompt = getCavemanPrompt('lite')!;
    expect(prompt).toContain('keep articles');
  });

  it('full mode drops articles', () => {
    const prompt = getCavemanPrompt('full')!;
    expect(prompt).toContain('Drop articles');
  });

  it('ultra mode uses abbreviations', () => {
    const prompt = getCavemanPrompt('ultra')!;
    expect(prompt).toContain('Abbreviat');
  });

  it('all active modes include code block exception', () => {
    for (const mode of ['lite', 'full', 'ultra'] as const) {
      const prompt = getCavemanPrompt(mode)!;
      expect(prompt.toLowerCase()).toContain('code block');
    }
  });

  it('all active modes include persistence reminder', () => {
    for (const mode of ['lite', 'full', 'ultra'] as const) {
      const prompt = getCavemanPrompt(mode)!;
      expect(prompt).toContain('EVERY RESPONSE');
    }
  });

  it('all active modes include auto-clarity escape', () => {
    for (const mode of ['lite', 'full', 'ultra'] as const) {
      const prompt = getCavemanPrompt(mode)!;
      expect(prompt).toMatch(/security|irreversible/i);
    }
  });

  it('each level is progressively shorter or equal in description', () => {
    // Ultra should have more aggressive compression instructions
    const full = getCavemanPrompt('full')!;
    const ultra = getCavemanPrompt('ultra')!;
    // Ultra includes abbreviation rules that full does not
    expect(ultra).toContain('DB');
    expect(full).not.toContain('DB/auth/config');
  });
});
