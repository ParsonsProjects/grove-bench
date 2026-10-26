import Fuse from 'fuse.js';
import type { SkillInfo } from '../../shared/types.js';

/** A section of the Skills drawer's This thread tab: where its skills live. */
export type SkillGroupId = SkillInfo['source'];

export interface SkillGroup {
  id: SkillGroupId;
  label: string;
  /** Where the section's skills come from, in a few words. */
  hint: string;
}

/** The sections in the order they show. */
export const SKILL_GROUPS: readonly SkillGroup[] = [
  { id: 'project', label: 'Project', hint: 'In this project, for anyone working on it' },
  { id: 'user', label: 'Personal', hint: 'In your user folder, for all your projects' },
  { id: 'session', label: 'Plugin and built-in', hint: 'From the running agent, with no file to edit' },
];

/** The skills matching `query` by name or, less strongly, description, best
 *  match first. A blank query keeps them all, in the order given. */
export function searchSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  const q = query.trim();
  if (!q) return skills;
  // ignoreLocation: a word late in a long description matches as well as
  // one at the start.
  const fuse = new Fuse(skills, { keys: [{ name: 'name', weight: 2 }, 'description'], threshold: 0.35, ignoreLocation: true });
  return fuse.search(q).map((r) => r.item);
}

/** The skills under their sections, in section order, without empty ones. */
export function groupSkills(skills: SkillInfo[]): (SkillGroup & { skills: SkillInfo[] })[] {
  return SKILL_GROUPS
    .map((group) => ({ ...group, skills: skills.filter((s) => s.source === group.id) }))
    .filter((group) => group.skills.length > 0);
}
