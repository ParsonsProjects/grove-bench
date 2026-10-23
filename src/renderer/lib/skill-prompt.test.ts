import { describe, it, expect } from 'vitest';
import { buildCreateSkillPrompt } from './skill-prompt.js';

describe('buildCreateSkillPrompt', () => {
  it('names the skill and routes project scope into the shared folder in the repository', () => {
    const p = buildCreateSkillPrompt({ name: 'release-notes', description: 'Draft release notes', scope: 'project' });
    expect(p).toContain('`release-notes`');
    expect(p).toContain('as `.agents/skills/release-notes/SKILL.md` in this repository');
    expect(p).not.toContain('.claude');
    expect(p).toContain('branch is only for this skill');
    expect(p).toContain('Draft release notes');
  });

  it('routes user scope to the shared folder at home and keeps it out of the project', () => {
    const p = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'user' });
    expect(p).toContain('`~/.agents/skills/x/SKILL.md` in your home folder');
    expect(p).toContain("Don't change this repository's files");
    expect(p).not.toContain('in this repository');
  });

  it('promises no branch for a project skill written in the project folder', () => {
    const p = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'project' }, false);
    expect(p).toContain('`.agents/skills/x/SKILL.md` in this project folder');
    expect(p).not.toContain('branch');
  });

  it('includes draft notes only when provided and non-blank', () => {
    const withNotes = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'project', notes: 'Step 1: build' });
    expect(withNotes).toContain('Step 1: build');
    const blankNotes = buildCreateSkillPrompt({ name: 'x', description: 'd', scope: 'project', notes: '   ' });
    expect(blankNotes).not.toContain('Draft notes');
  });
});
