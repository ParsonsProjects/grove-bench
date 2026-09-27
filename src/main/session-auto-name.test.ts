import { describe, it, expect, vi } from 'vitest';
import { decideAutoName, type AutoNameSources } from './session-auto-name.js';
import { legacySessionName } from '../shared/session-name.js';

function sources(opts: { title?: string | null | Error; prompt?: string | null } = {}): AutoNameSources & {
  providerTitle: ReturnType<typeof vi.fn>;
  firstPrompt: ReturnType<typeof vi.fn>;
} {
  return {
    providerTitle: vi.fn(async () => {
      if (opts.title instanceof Error) throw opts.title;
      return opts.title ?? null;
    }),
    firstPrompt: vi.fn(() => opts.prompt ?? null),
  };
}

describe('decideAutoName', () => {
  it('never touches a user-set name', async () => {
    const src = sources({ title: 'Sidebar sort order', prompt: 'can you fix the sort' });
    expect(await decideAutoName({ displayName: 'My name', source: 'user' }, src)).toBeNull();
    expect(src.providerTitle).not.toHaveBeenCalled();
    expect(src.firstPrompt).not.toHaveBeenCalled();
  });

  it('prefers the provider title over the heuristic', async () => {
    const src = sources({ title: '  Sidebar sort order ', prompt: 'can you fix the sort' });
    expect(await decideAutoName({ displayName: null }, src)).toEqual({ displayName: 'Sidebar sort order', source: 'auto' });
    expect(src.firstPrompt).not.toHaveBeenCalled();
  });

  it('falls back to the heuristic name when there is no provider title', async () => {
    const src = sources({ title: null, prompt: 'Can you look at the flaky e2e retries' });
    expect(await decideAutoName({ displayName: null, source: 'auto' }, src)).toEqual({ displayName: 'Flaky e2e retries', source: 'auto' });
  });

  it('treats a failing title lookup as no title', async () => {
    const src = sources({ title: new Error('no transcript'), prompt: 'please add dark mode' });
    expect(await decideAutoName({ displayName: null }, src)).toEqual({ displayName: 'Add dark mode', source: 'auto' });
  });

  it('upgrades an auto name once the provider title appears, then leaves it', async () => {
    const state = { displayName: 'Flaky e2e retries', source: 'auto' as const };
    expect(await decideAutoName(state, sources({ title: 'Retry flaky e2e tests' })))
      .toEqual({ displayName: 'Retry flaky e2e tests', source: 'auto' });
    expect(await decideAutoName({ displayName: 'Retry flaky e2e tests', source: 'auto' }, sources({ title: 'Retry flaky e2e tests' })))
      .toBeNull();
  });

  it('keeps an existing auto name without re-reading the prompt when there is no title', async () => {
    const src = sources({ title: null, prompt: 'anything' });
    expect(await decideAutoName({ displayName: 'Flaky e2e retries', source: 'auto' }, src)).toBeNull();
    expect(src.firstPrompt).not.toHaveBeenCalled();
  });

  it('caps a runaway provider title', async () => {
    const result = await decideAutoName({ displayName: null }, sources({ title: 'x'.repeat(200) }));
    expect(result?.displayName).toBe(`${'x'.repeat(80)}…`);
  });

  it('returns null when there is nothing to name from', async () => {
    expect(await decideAutoName({ displayName: null }, sources())).toBeNull();
    expect(await decideAutoName({ displayName: null }, sources({ prompt: '/clear' }))).toBeNull();
  });

  describe('entries saved before the source was tracked', () => {
    it('replaces a name that matches the old heuristic', async () => {
      const prompt = 'Can you look at the sidebar sort order and fix it';
      const state = { displayName: 'Can you look at the sidebar sort order…' };
      expect(await decideAutoName(state, sources({ prompt }))).toEqual({ displayName: 'Sidebar sort order and fix it', source: 'auto' });
      expect(await decideAutoName(state, sources({ prompt, title: 'Fix sidebar sort' }))).toEqual({ displayName: 'Fix sidebar sort', source: 'auto' });
    });

    it('recognises old names derived from the sent text with file blocks', async () => {
      const prompt = '<file path="a.ts">\nx\n</file>\n\ncan you fix the parser';
      expect(await decideAutoName({ displayName: 'can you fix the parser' }, sources({ prompt })))
        .toEqual({ displayName: 'Fix the parser', source: 'auto' });
      const oldRawName = legacySessionName(prompt)!;
      expect(oldRawName.startsWith('<file path="a.ts">')).toBe(true);
      expect(await decideAutoName({ displayName: oldRawName }, sources({ prompt })))
        .toEqual({ displayName: 'Fix the parser', source: 'auto' });
    });

    it('marks any other name as user-set and keeps it', async () => {
      const src = sources({ title: 'Fix sidebar sort', prompt: 'Can you look at the sidebar sort order' });
      expect(await decideAutoName({ displayName: 'Sort bug' }, src)).toEqual({ displayName: 'Sort bug', source: 'user' });
      expect(src.providerTitle).not.toHaveBeenCalled();
    });

    it('marks a name as user-set when the prompt is gone', async () => {
      expect(await decideAutoName({ displayName: 'Sort bug' }, sources({ prompt: null })))
        .toEqual({ displayName: 'Sort bug', source: 'user' });
    });

    it('records the source even when the new heuristic gives the same name', async () => {
      expect(await decideAutoName({ displayName: 'Add dark mode' }, sources({ prompt: 'Add dark mode' })))
        .toEqual({ displayName: 'Add dark mode', source: 'auto' });
    });
  });
});
