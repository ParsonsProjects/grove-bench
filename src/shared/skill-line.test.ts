import { describe, it, expect } from 'vitest';
import { skillLine, splitSkillLine, withSkill } from './skill-line.js';
import { skillRunPrompt } from './skill-schedules.js';

describe('skill lines', () => {
  it('asks for a skill the same way a run does', () => {
    expect(skillLine('triage')).toBe('Use the `triage` skill for this task.');
    expect(skillRunPrompt({ skill: 'triage', note: 'Top issue' }).startsWith(skillLine('triage'))).toBe(true);
  });

  it('finds the skill a message starts with, and the rest', () => {
    expect(splitSkillLine('Use the `triage` skill for this task.\n\nTop issue')).toEqual({ skill: 'triage', rest: 'Top issue' });
    expect(splitSkillLine('Use the `triage` skill.')).toEqual({ skill: 'triage', rest: '' });
    expect(splitSkillLine('Use the `triage` skill for this task.\r\nTop issue')).toEqual({ skill: 'triage', rest: 'Top issue' });
    expect(splitSkillLine('Please use the `triage` skill for this task.')).toBeNull();
    expect(splitSkillLine('Use the `triage` skill for this task. And then')).toBeNull();
  });

  it('puts a skill first, replacing one already asked for and keeping the rest', () => {
    expect(withSkill('', 'triage')).toBe('Use the `triage` skill for this task.\n\n');
    expect(withSkill('Fix the login bug', 'triage')).toBe('Use the `triage` skill for this task.\n\nFix the login bug');
    expect(withSkill('Use the `triage` skill for this task.\n\nFix it', 'deploy')).toBe('Use the `deploy` skill for this task.\n\nFix it');
    expect(withSkill('Use the `triage` skill for this task.\n\nFix it', null)).toBe('Fix it');
  });
});
