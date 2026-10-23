import type { SkillInfo } from '../../shared/types.js';

/**
 * Merge the on-disk skill scan with the names the running session reported in
 * its init message. Disk entries win (they carry descriptions and sources);
 * session-only names — typically plugin-provided skills — are appended with
 * source 'session'. Sorted by name for a stable list.
 */
export function mergeSkills(diskSkills: SkillInfo[], sessionSkillNames: string[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>(diskSkills.map((s) => [s.name, s]));
  for (const name of sessionSkillNames) {
    if (!byName.has(name)) {
      byName.set(name, { name, description: '', source: 'session' });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
