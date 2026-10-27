/**
 * The Agent Skills rules for a skill's name and description
 * (github.com/agentskills/agentskills, docs/specification.mdx): checked the
 * same way in the Add Skill dialog, in main before a skill is written, and on
 * suggested skills.
 */

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

/** Lowercase letters and digits in words joined by single hyphens, so no
 *  hyphen at either end or two in a row. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What's wrong with a skill name, in a sentence, or null when nothing is. */
export function skillNameProblem(name: string): string | null {
  if (!SKILL_NAME.test(name)) {
    return 'Use lowercase letters, digits and single hyphens, with no hyphen at the start or end (e.g. "release-notes")';
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) return `Keep the name to ${MAX_SKILL_NAME_LENGTH} characters or fewer`;
  return null;
}

/** What's wrong with a skill description, or null when nothing is. */
export function skillDescriptionProblem(description: string): string | null {
  if (!description.trim()) return 'Skill description is required';
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    return `Keep the description to ${MAX_SKILL_DESCRIPTION_LENGTH} characters or fewer`;
  }
  return null;
}
