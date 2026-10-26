import { describe, it, expect } from 'vitest';
import { groupSkills, searchSkills } from './skill-groups.js';
import type { SkillInfo } from '../../shared/types.js';

const skills: SkillInfo[] = [
  { name: 'deploy', description: 'Ship the app to staging', source: 'user' },
  { name: 'release-notes', description: 'Draft notes for the changelog from merged pull requests', source: 'project' },
  { name: 'triage', description: 'Sort new issues', source: 'project' },
  { name: 'engineering:code-review', description: '', source: 'session' },
];

describe('searchSkills', () => {
  it('keeps every skill, in order, for a blank search', () => {
    expect(searchSkills(skills, '  ')).toBe(skills);
  });

  it('finds a skill by part of its name, despite a typo', () => {
    expect(searchSkills(skills, 'trage').map((s) => s.name)).toEqual(['triage']);
    expect(searchSkills(skills, 'review').map((s) => s.name)).toEqual(['engineering:code-review']);
  });

  it('finds a skill by a word late in its description', () => {
    expect(searchSkills(skills, 'pull requests').map((s) => s.name)).toEqual(['release-notes']);
  });

  it('puts a name match ahead of a description match', () => {
    const both: SkillInfo[] = [
      { name: 'lint', description: 'Fix what deploy checks flag', source: 'project' },
      { name: 'deploy', description: 'Ship it', source: 'project' },
    ];
    expect(searchSkills(both, 'deploy').map((s) => s.name)).toEqual(['deploy', 'lint']);
  });

  it('finds nothing for an unrelated word', () => {
    expect(searchSkills(skills, 'kubernetes')).toEqual([]);
  });
});

describe('groupSkills', () => {
  it('puts project, then personal, then plugin and built-in skills in sections, without empty ones', () => {
    const groups = groupSkills(skills);
    expect(groups.map((g) => [g.label, g.skills.map((s) => s.name)])).toEqual([
      ['Project', ['release-notes', 'triage']],
      ['Personal', ['deploy']],
      ['Plugin and built-in', ['engineering:code-review']],
    ]);
    expect(groupSkills(skills.filter((s) => s.source === 'user')).map((g) => g.id)).toEqual(['user']);
  });
});
