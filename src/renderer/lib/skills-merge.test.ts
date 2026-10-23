import { describe, it, expect } from 'vitest';
import { mergeSkills } from './skills-merge.js';
import type { SkillInfo } from '../../shared/types.js';

const disk: SkillInfo[] = [
  { name: 'code-review', description: 'Review diffs', source: 'project', path: '/w/.claude/skills/code-review/SKILL.md' },
  { name: 'release-notes', description: 'Draft notes', source: 'user', path: '/h/.claude/skills/release-notes/SKILL.md' },
];

describe('mergeSkills', () => {
  it('keeps disk entries and appends session-only names as plugin skills', () => {
    const merged = mergeSkills(disk, ['code-review', 'changelog-bot']);
    expect(merged.map((s) => s.name)).toEqual(['changelog-bot', 'code-review', 'release-notes']);
    expect(merged.find((s) => s.name === 'changelog-bot')).toEqual({
      name: 'changelog-bot', description: '', source: 'session',
    });
  });

  it('prefers the disk entry when both report the same skill', () => {
    const merged = mergeSkills(disk, ['code-review']);
    expect(merged.find((s) => s.name === 'code-review')?.description).toBe('Review diffs');
  });

  it('handles an empty scan (session names only) and an empty session', () => {
    expect(mergeSkills([], ['a'])).toEqual([{ name: 'a', description: '', source: 'session' }]);
    expect(mergeSkills(disk, []).map((s) => s.name)).toEqual(['code-review', 'release-notes']);
  });
});
