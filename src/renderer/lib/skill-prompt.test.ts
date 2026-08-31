import { describe, it, expect } from 'vitest';
import { buildCreateSkillPrompt } from './skill-prompt.js';

describe('buildCreateSkillPrompt', () => {
  it('names the skill and routes project scope into the repository', () => {
    const p = buildCreateSkillPrompt({ name: 'release-notes', description: 'Draft release notes', scope: 'project' });
    expect(p).toContain('`release-notes`');
    expect(p).toContain('inside this repository');
    expect(p).toContain('Draft release notes');
  });

  it('routes user scope to the user-level location', () => {
    const p = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'user' });
    expect(p).toContain('user-level skills location');
    expect(p).not.toContain('inside this repository');
  });

  it('includes draft notes only when provided and non-blank', () => {
    const withNotes = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'project', notes: 'Step 1: build' });
    expect(withNotes).toContain('Step 1: build');
    const blankNotes = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'project', notes: '   ' });
    expect(blankNotes).not.toContain('Draft notes');
  });
});
